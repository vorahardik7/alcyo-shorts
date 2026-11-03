// The planner in main (plan sections 16 and 17, spec 8): Find shorts and chat
// messages through the signed-in agent. Electron-free, so it's tested with
// fakes. Agent calls run here, not on the worker's job queue: they only wait
// on a child process or a fetch, so proxies keep building meanwhile.
//
// One agent job runs per stream at a time; messages sent meanwhile wait in turn.
import { PLACED_MIN } from "@alcyo/import";
import type { AgentWork, EventName, EventPayload } from "@alcyo/ipc";
import {
  DEFAULT_COUNT,
  type PlanInputs,
  PlannerError,
  chatAction,
  findShorts,
  spanOfVersion,
} from "@alcyo/planner";
import { defaultProfile } from "@alcyo/profile";
import {
  type Message,
  Probe,
  type ShortRef,
  type ShortVersion,
  Silences,
  type Source,
} from "@alcyo/schema";
import {
  type ProfileStore,
  type ProjectStore,
  StoreError,
  exists,
  newId,
  readJson,
} from "@alcyo/store";
import { z } from "zod";
import type { AgentService } from "./agent";
import type { StreamService } from "./streams";

export const NOT_READY = "The transcript isn't in yet. Find shorts and chat open as soon as it is.";
export const NO_SOURCE = "Add the stream's recording first, then find shorts.";
export const STOPPED = "Stopped. Nothing changed.";

export interface PlannerDeps {
  streams: Pick<StreamService, "forStream" | "post" | "touch">;
  agent: Pick<AgentService, "provider" | "model" | "label">;
  profiles: Pick<ProfileStore, "profile" | "presets">;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  /** Tests: smaller windows for long streams. */
  limits?: { maxTokens?: number; windowTokens?: number; overlapTokens?: number };
  log?: (line: string) => void;
}

interface Work extends AgentWork {
  streamId: string;
  controller: AbortController;
}

const ProbeFile = z.object({ probe: Probe });

function plain(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 600) || "The agent didn't answer. Try again.";
}

function site(source: Source): string | null {
  const url = source.info?.webpageUrl ?? (source.origin.kind === "url" ? source.origin.url : null);
  if (url === null) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export class PlannerService {
  private working = new Map<string, Work>();
  private chains = new Map<string, Promise<void>>();
  /** Jobs cancelled while they were still waiting their turn. */
  private dropped = new Set<string>();
  private readonly log: (line: string) => void;

  constructor(private readonly deps: PlannerDeps) {
    this.log = deps.log ?? ((line) => console.error(`[planner] ${line}`));
  }

  /** The first source with a transcript, or null. */
  private async transcribed(store: ProjectStore): Promise<Source | null> {
    for (const { source } of await store.sources()) {
      if (await exists(store.paths.analysis(source.sourceId, "transcript.json"))) return source;
    }
    return null;
  }

  async state(streamId: string): Promise<{ ready: boolean; working: AgentWork | null }> {
    const store = await this.deps.streams.forStream(streamId);
    const w = this.working.get(streamId);
    return {
      ready: (await this.transcribed(store)) !== null,
      working: w === undefined ? null : { jobId: w.jobId, label: w.label },
    };
  }

  private async inputs(store: ProjectStore): Promise<PlanInputs & { sourceId: string }> {
    const source = await this.transcribed(store);
    if (source === null) {
      throw new StoreError(
        "not-found",
        (await store.project()).sources.length === 0 ? NO_SOURCE : NOT_READY,
      );
    }
    const id = source.sourceId;
    const transcript = await store.transcript(id);
    const silences = (await readJson(store.paths.analysis(id, "silences.json"), Silences))
      ?.silences;
    // Analysis saves the probe to source.json at the end; mid-analysis it's in probe.json.
    const durationMs =
      source.probe?.durationMs ??
      (await readJson(store.paths.analysis(id, "probe.json"), ProbeFile))?.probe.durationMs ??
      transcript.words.at(-1)?.endMs ??
      0;
    const clips = (await store.clips())
      .map((c) => c.match)
      .filter((m) => m !== null && m.confidence >= PLACED_MIN)
      .map((m) => ({ startMs: m!.srcIn, endMs: m!.srcOut }));
    const [profile, presets, project] = await Promise.all([
      this.deps.profiles.profile(),
      this.deps.profiles.presets(),
      store.project(),
    ]);
    const date = source.info?.uploadDate;
    return {
      sourceId: id,
      transcript,
      sourceDurationMs: durationMs,
      silences: silences ?? [],
      clips,
      profile: profile ?? defaultProfile(),
      presets,
      stream: {
        name: project.name,
        durationMs,
        site: site(source),
        uploaded:
          date === null || date === undefined
            ? null
            : `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
        clipsMatched: clips.length,
      },
    };
  }

  private async heads(store: ProjectStore): Promise<ShortVersion[]> {
    const project = await store.project();
    return Promise.all(project.shorts.map((s) => store.version(s.shortId)));
  }

  private setWorking(streamId: string, work: Work | null): void {
    if (work === null) this.working.delete(streamId);
    else this.working.set(streamId, work);
    this.deps.emit("thread:working", {
      streamId,
      working: work === null ? null : { jobId: work.jobId, label: work.label },
    });
  }

  /** Runs body after the stream's earlier agent jobs, with the working indicator and cancel. */
  private queue(
    streamId: string,
    doing: string,
    body: (signal: AbortSignal, store: ProjectStore) => Promise<void>,
  ): { jobId: string } {
    const jobId = newId("job");
    const run = async () => {
      if (this.dropped.delete(jobId)) return;
      const store = await this.deps.streams.forStream(streamId);
      const who = (await this.deps.agent.label().catch(() => null)) ?? "The agent";
      const work: Work = {
        streamId,
        jobId,
        label: `${who} is ${doing}`,
        controller: new AbortController(),
      };
      this.setWorking(streamId, work);
      try {
        await body(work.controller.signal, store);
      } catch (error) {
        const cancelled =
          work.controller.signal.aborted ||
          (error instanceof PlannerError && error.code === "cancelled");
        const text = cancelled ? STOPPED : plain(error);
        if (!cancelled) this.log(`${doing} failed: ${text}`);
        await this.deps.streams.post(streamId, { kind: "text", text });
        await this.deps.streams.touch(streamId, text, { unread: !cancelled });
      } finally {
        this.setWorking(streamId, null);
      }
    };
    const prev = this.chains.get(streamId) ?? Promise.resolve();
    const next = prev.then(run, run).catch((error: unknown) => this.log(plain(error)));
    this.chains.set(streamId, next);
    return { jobId };
  }

  cancel(jobId: string): boolean {
    for (const w of this.working.values()) {
      if (w.jobId === jobId) {
        w.controller.abort();
        return true;
      }
    }
    // Possibly still waiting; it won't start. Unknown ids are harmless here.
    this.dropped.add(jobId);
    return false;
  }

  /** Find shorts on request. Throws a plain StoreError when the transcript isn't in. */
  async find(streamId: string): Promise<{ jobId: string }> {
    const store = await this.deps.streams.forStream(streamId);
    if ((await this.transcribed(store)) === null) {
      throw new StoreError(
        "not-found",
        (await store.project()).sources.length === 0 ? NO_SOURCE : NOT_READY,
      );
    }
    return this.queue(streamId, "finding shorts", (signal, s) =>
      this.runFind(streamId, s, signal, {
        count: DEFAULT_COUNT,
        request: null,
        fromMessageId: null,
      }),
    );
  }

  private async runFind(
    streamId: string,
    store: ProjectStore,
    signal: AbortSignal,
    opts: { count: number; request: string | null; fromMessageId: string | null },
  ): Promise<void> {
    const inputs = await this.inputs(store);
    const existing = await this.heads(store);
    const shorts = await findShorts(await this.deps.agent.provider(), inputs, {
      count: opts.count,
      ...(opts.request === null ? {} : { request: opts.request }),
      exclude: existing.map(spanOfVersion),
      model: await this.deps.agent.model(),
      signal,
      ...this.deps.limits,
      log: this.log,
    });
    if (signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
    const refs: ShortRef[] = [];
    for (const short of shorts) {
      const v = await store.createShort({
        sourceId: inputs.sourceId,
        short,
        createdBy: "claude",
        note: opts.request === null ? "Proposed" : `Asked for: ${opts.request}`.slice(0, 200),
        fromMessageId: opts.fromMessageId,
      });
      refs.push({ shortId: v.shortId, version: v.version });
    }
    const n = refs.length;
    const intro =
      existing.length === 0
        ? `Here ${n === 1 ? "is a short" : `are ${n} shorts`} from this stream. Reply to a card to change it.`
        : `Here ${n === 1 ? "is 1 more short" : `are ${n} more shorts`}. Reply to a card to change it.`;
    await this.deps.streams.post(
      streamId,
      { kind: "shorts", intro, shorts: refs },
      { author: "claude" },
    );
    await this.deps.streams.touch(streamId, intro, { unread: true });
  }

  /** A chat message: posted now, then one checked action in turn. */
  async send(streamId: string, text: string, replyTo?: ShortRef): Promise<{ messageId: string }> {
    const message = await this.deps.streams.post(
      streamId,
      { kind: "text", text: text.trim().slice(0, 4000) },
      { author: "user", ...(replyTo === undefined ? {} : { replyTo }) },
    );
    await this.deps.streams.touch(streamId, message.body.kind === "text" ? message.body.text : "");
    this.queue(streamId, "reading your message", (signal, store) =>
      this.runChat(streamId, store, signal, message),
    );
    return { messageId: message.id };
  }

  private async runChat(
    streamId: string,
    store: ProjectStore,
    signal: AbortSignal,
    message: Message,
  ): Promise<void> {
    if (message.body.kind !== "text") return;
    const inputs = await this.inputs(store);
    const shorts = await this.heads(store);
    const all = await store.messages();
    const at = all.findIndex((m) => m.id === message.id);
    const before = at === -1 ? all : all.slice(0, at);
    const reply =
      message.replyTo !== undefined && shorts.some((s) => s.shortId === message.replyTo!.shortId)
        ? message.replyTo
        : undefined;
    const result = await chatAction(
      await this.deps.agent.provider(),
      {
        ...inputs,
        shorts,
        messages: before,
        text: message.body.text,
        ...(reply === undefined ? {} : { replyTo: reply }),
      },
      { model: await this.deps.agent.model(), signal, log: this.log },
    );
    if (signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
    switch (result.kind) {
      case "versions": {
        let last = "";
        for (const c of result.changes) {
          const v = await store.saveVersion(c.shortId, {
            short: c.short,
            createdBy: c.createdBy,
            note: c.note,
            fromMessageId: message.id,
          });
          await this.deps.streams.post(
            streamId,
            {
              kind: "version",
              ref: { shortId: v.shortId, version: v.version },
              whatChanged: c.whatChanged,
            },
            { author: "claude" },
          );
          last = `v${v.version} of “${c.short.title}”: ${c.whatChanged}`;
        }
        await this.deps.streams.touch(streamId, last, { unread: true });
        return;
      }
      case "new_shorts":
        await this.runFind(streamId, store, signal, {
          count: result.count,
          request: result.request.length > 0 ? result.request : null,
          fromMessageId: message.id,
        });
        return;
      case "answer":
      case "clarify":
        await this.deps.streams.post(
          streamId,
          { kind: "text", text: result.text.slice(0, 4000) },
          { author: "claude" },
        );
        await this.deps.streams.touch(streamId, result.text, { unread: true });
        return;
    }
  }

  /**
   * The one automatic Find shorts per stream: once the transcript is in and no
   * clip is waiting to be placed, or after the clip checks that follow analysis.
   */
  async ready(streamId: string, phase: "transcript" | "clips"): Promise<void> {
    try {
      const store = await this.deps.streams.forStream(streamId);
      if ((await this.transcribed(store)) === null) return;
      if (phase === "transcript" && (await store.clips()).some((c) => c.match === null)) return;
      const project = await store.project();
      if (project.autoFindAt !== null) return;
      if (!(await store.claimAutoFind())) return;
      // Shorts made some other way already: nothing to find by itself.
      if (project.shorts.length > 0) return;
      this.queue(streamId, "finding shorts", (signal, s) =>
        this.runFind(streamId, s, signal, {
          count: DEFAULT_COUNT,
          request: null,
          fromMessageId: null,
        }),
      );
    } catch (error) {
      this.log(`Automatic Find shorts didn't start: ${plain(error)}`);
    }
  }

  /** Waits for every agent job on a stream. For tests. */
  async idle(streamId: string): Promise<void> {
    let seen: Promise<void> | undefined;
    while (seen !== this.chains.get(streamId)) {
      seen = this.chains.get(streamId);
      await seen;
    }
  }
}
