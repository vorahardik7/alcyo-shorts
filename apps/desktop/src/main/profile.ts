// The creator profile in main (plan section 13, spec 7): the interview, past
// shorts, the style summary and templates. Electron-free, so it's tested with
// fakes. Past shorts are analyzed in place and never copied.
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  type AnalysisRequest,
  InterviewState,
  type PendingSample,
  type ProfileView,
} from "@alcyo/ipc";
import { nextInterviewStep, writeStyleSummary } from "@alcyo/planner";
import {
  DEFAULT_DRAFT,
  MAX_SAMPLES,
  defaultProfile,
  exportTemplate,
  importTemplate,
  measurePastShort,
  parseAss,
  profileFromDraft,
  slug,
  styleFrom,
} from "@alcyo/profile";
import { type CreatorProfile, Loudness, Scenes, Silences, Transcript } from "@alcyo/schema";
import {
  type ProfileStore,
  StoreError,
  newId,
  readJson,
  writeFileAtomic,
  writeJsonAtomic,
} from "@alcyo/store";
import type { AgentService } from "./agent";
import type { AnalysisWorker } from "./streams";

export interface ProfileServiceDeps {
  store: ProfileStore;
  /** userData/interview.json */
  interviewPath: string;
  agent: Pick<AgentService, "provider" | "model" | "label">;
  worker: () => AnalysisWorker;
  analysisBase: () => Promise<
    Omit<AnalysisRequest, "sourceId" | "sourcePath" | "analysisDir" | "cacheDir">
  >;
  /** Runs fn on the one job queue, after the jobs already in it. */
  runExclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  chooseShorts: () => Promise<string[]>;
  chooseTemplate: () => Promise<string | null>;
  chooseExport: (suggested: string) => Promise<string | null>;
  emit: () => void;
  now?: () => Date;
  log?: (line: string) => void;
}

const fresh = (): InterviewState => ({
  schemaVersion: 1,
  phase: "start",
  turns: [],
  question: null,
  draft: null,
  error: null,
});

function plain(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 300) || "The agent didn't answer. Try again.";
}

export class ProfileService {
  private pending = new Map<string, PendingSample>();
  private asking: Promise<InterviewState> | null = null;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: ProfileServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((line) => console.error(`[profile] ${line}`));
  }

  async view(): Promise<ProfileView> {
    const [profile, presets, samples, agent] = await Promise.all([
      this.deps.store.profile(),
      this.deps.store.presets(),
      this.deps.store.samples(),
      this.deps.agent.label().catch(() => null),
    ]);
    return { profile, ...presets, samples, pending: [...this.pending.values()], agent };
  }

  async save(profile: CreatorProfile): Promise<ProfileView> {
    await this.deps.store.saveProfile(profile);
    this.deps.emit();
    return this.view();
  }

  // The interview

  async interview(): Promise<InterviewState> {
    return (await readJson(this.deps.interviewPath, InterviewState).catch(() => null)) ?? fresh();
  }

  private async put(state: InterviewState): Promise<InterviewState> {
    const next = InterviewState.parse(state);
    await writeJsonAtomic(this.deps.interviewPath, next);
    return next;
  }

  /** One agent call at a time; a second click waits for the first. */
  private once(fn: () => Promise<InterviewState>): Promise<InterviewState> {
    if (this.asking !== null) return this.asking;
    this.asking = fn().finally(() => {
      this.asking = null;
    });
    return this.asking;
  }

  private async step(state: InterviewState, finishNow: boolean): Promise<InterviewState> {
    try {
      const step = await nextInterviewStep(await this.deps.agent.provider(), state.turns, {
        model: await this.deps.agent.model(),
        signal: new AbortController().signal,
        finishNow,
      });
      if (step.kind === "question") {
        return this.put({
          ...state,
          phase: "asking",
          question: { text: step.text, chips: step.chips },
          error: null,
        });
      }
      return this.put({
        ...state,
        phase: "look",
        question: null,
        draft: step.profile,
        error: null,
      });
    } catch (error) {
      this.log(`Interview step failed: ${plain(error)}`);
      throw error;
    }
  }

  start(): Promise<InterviewState> {
    return this.once(async () => {
      const state = await this.put(fresh());
      try {
        return await this.step(state, false);
      } catch (error) {
        return this.put({ ...state, error: plain(error) });
      }
    });
  }

  /** An answer, a skip (null), or finish now. A failure keeps the question so it can be sent again. */
  answer(answer: string | null, finishNow = false): Promise<InterviewState> {
    return this.once(async () => {
      const state = await this.interview();
      if (state.phase !== "asking" || state.question === null) {
        throw new StoreError(
          "not-found",
          "There's no question waiting. Start the interview again.",
        );
      }
      const text = answer === null ? null : answer.trim().slice(0, 1000) || null;
      const next: InterviewState = {
        ...state,
        turns: [
          ...state.turns,
          { question: state.question.text, chips: state.question.chips, answer: text },
        ],
      };
      try {
        return await this.step(next, finishNow);
      } catch (error) {
        return this.put({ ...state, error: plain(error) });
      }
    });
  }

  /** Saves the profile from the draft (or every default) with the chosen look. */
  async finish(captionPresetId: string): Promise<ProfileView> {
    const state = await this.interview();
    const presets = await this.deps.store.presets();
    const existing = await this.deps.store.profile();
    const known = {
      captionIds: presets.captionPresets.map((p) => p.id),
      hookIds: presets.hookPresets.map((p) => p.id),
    };
    const profile = profileFromDraft(
      state.draft ?? DEFAULT_DRAFT,
      { captionPresetId },
      known,
      existing?.style ?? { summary: "", sampleCount: 0 },
    );
    await this.deps.store.saveProfile(profile);
    await this.put({ ...state, phase: "done", question: null, error: null });
    this.deps.emit();
    return this.view();
  }

  // Past shorts

  async addSamples(): Promise<{ added: number; skipped: number } | { cancelled: true }> {
    const paths = await this.deps.chooseShorts();
    if (paths.length === 0) return { cancelled: true };
    const have = (await this.deps.store.samples()).length + this.pending.size;
    const room = Math.max(0, MAX_SAMPLES - have);
    const take = paths.slice(0, room);
    for (const path of take) {
      const sampleId = newId("smp");
      this.pending.set(sampleId, {
        sampleId,
        fileName: basename(path),
        state: "waiting",
        message: null,
      });
      void this.deps
        .runExclusive(() => this.measure(sampleId, path))
        .catch((error: unknown) => this.log(`Past short ${sampleId}: ${plain(error)}`));
    }
    this.deps.emit();
    return { added: take.length, skipped: paths.length - take.length };
  }

  private async measure(sampleId: string, path: string): Promise<void> {
    const entry = this.pending.get(sampleId);
    if (entry === undefined) return;
    entry.state = "analyzing";
    this.deps.emit();
    const dir = this.deps.store.sampleDir(sampleId);
    const analysisDir = join(dir, "analysis");
    try {
      const request: AnalysisRequest = {
        ...(await this.deps.analysisBase()),
        mode: "quick",
        sourceId: sampleId,
        sourcePath: path,
        analysisDir,
        cacheDir: join(dir, "cache"),
      };
      const result = await this.deps.worker().analyze(request, () => undefined).done;
      // A step that didn't run (no speech, no model) leaves its file out.
      const at = (name: string) => join(analysisDir, name);
      const { measures, opening } = measurePastShort({
        durationMs: result.probe.durationMs,
        transcript: await readJson(at("transcript.json"), Transcript).catch(() => null),
        silences: await readJson(at("silences.json"), Silences).catch(() => null),
        scenes: await readJson(at("scenes.json"), Scenes).catch(() => null),
        loudness: await readJson(at("loudness.json"), Loudness).catch(() => null),
      });
      await this.deps.store.saveSample({
        schemaVersion: 1,
        sampleId,
        fileName: basename(path).slice(0, 260),
        addedAt: this.now().toISOString(),
        measures,
        opening,
      });
      await this.deps.store.dropSampleCache(sampleId);
      this.pending.delete(sampleId);
    } catch (error) {
      entry.state = "failed";
      entry.message = plain(error);
      await this.deps.store.removeSample(sampleId).catch(() => undefined);
    } finally {
      this.deps.emit();
    }
  }

  async removeSample(sampleId: string): Promise<ProfileView> {
    if (this.pending.get(sampleId)?.state === "failed") this.pending.delete(sampleId);
    else await this.deps.store.removeSample(sampleId);
    this.deps.emit();
    return this.view();
  }

  /** The agent writes the style summary; the numbers are measured, not written. */
  async writeStyle(): Promise<ProfileView> {
    const samples = await this.deps.store.samples();
    if (samples.length === 0) {
      throw new StoreError("not-found", "Add a few past shorts first, then write the summary.");
    }
    const summary = await writeStyleSummary(await this.deps.agent.provider(), samples, {
      model: await this.deps.agent.model(),
      signal: new AbortController().signal,
    });
    const profile = (await this.deps.store.profile()) ?? defaultProfile();
    return this.save({ ...profile, style: styleFrom(summary, samples) });
  }

  // Templates

  async importTemplate(): Promise<{ added: number; notes: string[] } | { cancelled: true }> {
    const path = await this.deps.chooseTemplate();
    if (path === null) return { cancelled: true };
    const text = await readFile(path, "utf8");
    let imported;
    if (extname(path).toLowerCase() === ".ass") {
      imported = parseAss(text, basename(path, extname(path)));
    } else {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new StoreError("bad-file", "That file isn't an Alcyo template or an .ass file.");
      }
      try {
        const t = importTemplate(raw);
        await this.deps.store.saveTemplate(slug(t.template.name), t.template);
        imported = t;
      } catch (error) {
        if (error instanceof StoreError) throw error;
        throw new StoreError(
          "bad-file",
          "That template couldn't be read. It may be from a newer version.",
        );
      }
    }
    await this.deps.store.addPresets(imported);
    this.deps.emit();
    return {
      added: imported.captionPresets.length + imported.hookPresets.length,
      notes: imported.notes.map((n) => n.slice(0, 300)),
    };
  }

  async exportTemplate(): Promise<{ path: string } | { cancelled: true }> {
    const profile = await this.deps.store.profile();
    const name = profile?.name.trim() ? `${profile.name.trim()}'s look` : "My look";
    const path = await this.deps.chooseExport(`${name}.alcyo-template.json`);
    if (path === null) return { cancelled: true };
    const all = await this.deps.store.presets();
    // The looks in use, plus every imported one.
    const pick = <T extends { id: string; origin: string }>(list: T[], inUse: string | undefined) =>
      list.filter((p) => p.origin !== "builtin" || p.id === inUse);
    const template = exportTemplate(
      name,
      {
        captionPresets: pick(all.captionPresets, profile?.captionPresetId),
        hookPresets: pick(all.hookPresets, profile?.hookPresetId),
      },
      profile,
    );
    await writeFileAtomic(path, `${JSON.stringify(template, null, 2)}\n`);
    return { path };
  }
}
