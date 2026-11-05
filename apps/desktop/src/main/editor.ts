// The editor in main (spec 11): one call that loads a version with
// everything the editor shows, and saving an edit as a user version with a
// version message in the thread. Electron-free.
import type { EditorView } from "@alcyo/ipc";
import { resolveShortStyles, snapshotShortStyles } from "@alcyo/render";
import { THUMB_EVERY_MS } from "@alcyo/media";
import { Silences, type Short, type ShortVersion } from "@alcyo/schema";
import { type ProfileStore, exists, readJson } from "@alcyo/store";
import { readdir } from "node:fs/promises";
import { MEDIA_SCHEME, playableFile, sourceUrl } from "./media-protocol";
import type { StreamService } from "./streams";

/** Words and silences this far past each end of the short, so trims can reach out. */
export const WINDOW_PAD_MS = 60_000;

export interface EditorDeps {
  streams: Pick<StreamService, "forStream" | "post" | "touch">;
  profiles: Pick<ProfileStore, "profile" | "presets">;
}

export class EditorService {
  constructor(private readonly deps: EditorDeps) {}

  async open(
    streamId: string,
    shortId: string,
    version?: number,
    range?: { fromMs: number; toMs: number },
  ): Promise<EditorView> {
    const store = await this.deps.streams.forStream(streamId);
    const file = await store.shortFile(shortId);
    let v = await store.version(shortId, version);
    const presets = await this.deps.profiles.presets();
    const styles =
      v.short.styles ??
      (await store.freezeStyles(shortId, v.version, resolveShortStyles(v.short, presets)));
    v = { ...v, short: { ...v.short, styles } };
    const draft = await store.draft(shortId, v.version);
    const working = draft?.short ?? v.short;
    const source = await store.source(v.sourceId);
    const video = source.probe?.video ?? null;
    const durationMs = source.probe?.durationMs ?? v.short.segments.at(-1)!.srcOut;
    const from = Math.max(
      0,
      Math.min(working.segments[0]!.srcIn, range?.fromMs ?? Infinity) - WINDOW_PAD_MS,
    );
    const to = Math.min(
      durationMs,
      Math.max(working.segments.at(-1)!.srcOut, range?.toMs ?? 0) + WINDOW_PAD_MS,
    );
    const win = await store
      .transcriptWindow(v.sourceId, from, to)
      .catch(() => ({ words: [], lines: [] }));
    const silences =
      (
        await readJson(store.paths.analysis(v.sourceId, "silences.json"), Silences)
      )?.silences.filter((s) => s.endMs > from && s.startMs < to) ?? [];
    const cache = store.paths.cacheDir(v.sourceId);
    const names = await readdir(cache).catch(() => [] as string[]);
    const thumbs = names.filter((n) => /^thumbs-\d{3,}\.jpg$/.test(n)).length;
    const playable = await playableFile(store, v.sourceId).catch(() => null);
    const [profile, versions, messages] = await Promise.all([
      this.deps.profiles.profile(),
      store.versions(shortId),
      store.messages(),
    ]);
    const asked = v.fromMessageId === null ? null : messages.find((m) => m.id === v.fromMessageId);
    return {
      version: v,
      head: file.head,
      draft,
      versions,
      fromMessage: asked?.body.kind === "text" ? asked.body.text : null,
      source: {
        src:
          playable === null || video === null
            ? null
            : sourceUrl(streamId, v.sourceId, source.mediaRevision),
        width: video?.width ?? 1920,
        height: video?.height ?? 1080,
        fpsNum: video?.fpsNum ?? 30,
        fpsDen: video?.fpsDen ?? 1,
        durationMs,
        peaks: (await exists(`${cache}/peaks.bin`))
          ? `${MEDIA_SCHEME}://peaks/${streamId}/${v.sourceId}`
          : null,
        thumbs: {
          base: `${MEDIA_SCHEME}://frames/${streamId}/${v.sourceId}`,
          everyMs: THUMB_EVERY_MS,
          count: thumbs,
        },
      },
      window: { fromMs: from, toMs: to },
      words: win.words,
      lines: win.lines,
      silences,
      captionPresets: [
        ...presets.captionPresets.filter((p) => p.id !== styles.caption.id),
        styles.caption,
      ],
      hookPresets: [...presets.hookPresets.filter((p) => p.id !== styles.hook.id), styles.hook],
      platforms: profile?.platforms ?? ["tiktok", "youtube-shorts", "reels"],
    };
  }

  async restore(streamId: string, shortId: string, version: number): Promise<ShortVersion> {
    const old = await (await this.deps.streams.forStream(streamId)).version(shortId, version);
    return this.save(streamId, shortId, {
      short: old.short,
      note: `Restored v${version}`,
      parent: version,
    });
  }

  /** Saves the creator's edit as a new version, and says so in the thread. */
  async save(
    streamId: string,
    shortId: string,
    opts: { short: Short; note: string; parent?: number },
  ): Promise<ShortVersion> {
    const store = await this.deps.streams.forStream(streamId);
    const v = await store.saveVersion(shortId, {
      short: snapshotShortStyles(opts.short, await this.deps.profiles.presets()),
      createdBy: "user",
      note: opts.note.trim().slice(0, 200) || "Edited",
      fromMessageId: null,
      ...(opts.parent === undefined ? {} : { parent: opts.parent }),
    });
    const what = opts.note.trim().slice(0, 300) || "Edited in the editor";
    await this.deps.streams.post(
      streamId,
      { kind: "version", ref: { shortId, version: v.version }, whatChanged: what },
      { author: "user" },
    );
    await this.deps.streams.touch(streamId, `Saved v${v.version} of “${v.short.title}”`);
    return v;
  }
}
