// One stream folder (plan section 15): the project, its sources, thread,
// shorts and transcript reads. Writes are serialized per folder.
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  type Clip,
  type ClipFile,
  type ClipMatch,
  type YtDlpInfo,
  ClipFile as ClipFileSchema,
  type Draft,
  type Fingerprint,
  type Message,
  type Probe,
  type Project,
  type Short,
  type ShortFile,
  type ShortVersion,
  type Source,
  type Transcript,
  type TranscriptWindow,
  type VersionSummary,
  Project as ProjectSchema,
  Draft as DraftSchema,
  ShortFile as ShortFileSchema,
  ShortVersion as ShortVersionSchema,
  Source as SourceSchema,
  checkShort,
} from "@alcyo/schema";
import {
  StoreError,
  exists,
  readProjectFile,
  removeQuietly,
  writeJsonAtomic,
  writeNewFileAtomic,
} from "./files.ts";
import { type ContentHash, hashFile, sameContent } from "./hash.ts";
import { newId } from "./ids.ts";
import { type Layout, layout } from "./layout.ts";
import { appendMessage, pageMessages, readMessages } from "./messages.ts";
import { uniqueStreamFolder } from "./names.ts";

export const MISMATCH_MESSAGE = "That's a different file. Choose the original recording.";
export const MAX_SEARCH_HITS = 50;

export interface LineHit {
  lineId: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface SourceView {
  source: Source;
  /** A file source whose path no longer exists. */
  missing: boolean;
}

/** The fingerprint string a version records: size and both hashes. */
export function fingerprintKey(fp: ContentHash): string {
  return `${fp.sizeBytes}:${fp.headSha256}:${fp.tailSha256}`;
}

/** Creates <dir>/<name>.alcyo with an empty project and thread. */
export async function createStream(opts: {
  dir: string;
  name: string;
  now?: Date;
  streamId?: string;
}): Promise<{ folder: string; project: Project }> {
  await mkdir(opts.dir, { recursive: true });
  const folder = await uniqueStreamFolder(opts.dir, opts.name);
  const paths = layout(folder);
  const project: Project = ProjectSchema.parse({
    schemaVersion: 1,
    streamId: opts.streamId ?? newId("s"),
    name: opts.name.trim().slice(0, 120) || "Stream",
    createdAt: (opts.now ?? new Date()).toISOString(),
    sources: [],
    shorts: [],
    clips: [],
    settings: { copyIntoProject: false },
  });
  await mkdir(paths.thread, { recursive: true });
  await writeJsonAtomic(paths.project, project);
  // An empty thread file, so the layout is complete from the start.
  await writeNewFileAtomic(paths.messages, "").catch(() => undefined);
  return { folder, project };
}

export class ProjectStore {
  readonly paths: Layout;
  private queue: Promise<unknown> = Promise.resolve();
  private transcriptCache = new Map<string, { mtimeMs: number; value: Transcript }>();

  constructor(
    readonly folder: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.paths = layout(folder);
  }

  /** Opens a folder, checking it's a stream. */
  static async open(folder: string, now?: () => Date): Promise<ProjectStore> {
    if (!(await exists(folder))) {
      throw new StoreError(
        "missing",
        "This stream's folder isn't where it was. It may have been moved or deleted.",
      );
    }
    const store = new ProjectStore(folder, now);
    await store.project();
    return store;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  project(): Promise<Project> {
    return readProjectFile<Project>(this.paths.project, "project", "project.json");
  }

  private updateProject(fn: (p: Project) => void): Promise<Project> {
    return this.serial(async () => {
      const p = await this.project();
      fn(p);
      const next = ProjectSchema.parse(p);
      await writeJsonAtomic(this.paths.project, next);
      return next;
    });
  }

  /** Marks the one automatic Find shorts. False when it already ran. */
  async claimAutoFind(): Promise<boolean> {
    let claimed = false;
    await this.updateProject((p) => {
      if (p.autoFindAt !== null) return;
      p.autoFindAt = this.now().toISOString();
      claimed = true;
    });
    return claimed;
  }

  rename(name: string): Promise<Project> {
    return this.updateProject((p) => {
      p.name = name.trim().slice(0, 120) || p.name;
    });
  }

  // Thread

  appendMessage(message: Message): Promise<void> {
    return this.serial(() => appendMessage(this.paths.messages, message));
  }

  async messages(): Promise<Message[]> {
    await this.queue;
    return (await readMessages(this.paths.messages)).messages;
  }

  async pageMessages(limit: number, before?: string): Promise<Message[]> {
    return pageMessages(await this.messages(), limit, before);
  }

  // Sources

  /**
   * Adds a local file. Referenced in place unless copy is set; nothing is ever
   * written next to it. The fingerprint's duration and layout are filled in
   * when analysis probes the file (applyAnalysis).
   */
  async addFileSource(path: string, opts: { copy?: boolean } = {}): Promise<Source> {
    const sourceId = newId("src");
    const content = await hashFile(path);
    let origin: Source["origin"] = { kind: "file", path, copied: false };
    if (opts.copy === true) {
      const dir = this.paths.sourceDir(sourceId);
      await mkdir(dir, { recursive: true });
      const target = join(dir, `media${extname(path).toLowerCase() || ".mp4"}`);
      await copyFile(path, target);
      origin = { kind: "file", path: target, copied: true };
    }
    const source: Source = SourceSchema.parse({
      schemaVersion: 1,
      sourceId,
      addedAt: this.now().toISOString(),
      origin,
      fingerprint: { ...content, durationMs: 0, layout: "" },
      probe: null,
      info: null,
    });
    await mkdir(this.paths.analysisDir(sourceId), { recursive: true });
    await writeJsonAtomic(this.paths.source(sourceId), source);
    await this.updateProject((p) => {
      p.sources.push({ sourceId });
    });
    return source;
  }

  source(sourceId: string): Promise<Source> {
    return readProjectFile<Source>(
      this.paths.source(sourceId),
      "source",
      `sources/${sourceId}/source.json`,
    );
  }

  async sources(): Promise<SourceView[]> {
    const project = await this.project();
    return Promise.all(
      project.sources.map(async ({ sourceId }) => {
        const source = await this.source(sourceId);
        return { source, missing: !(await exists(source.origin.path)) };
      }),
    );
  }

  /**
   * Registers a finished download already inside sources/<sourceId>/. A URL
   * import is always a copy in the project.
   */
  async addDownloadedSource(opts: {
    sourceId: string;
    url: string;
    path: string;
    info: YtDlpInfo;
  }): Promise<Source> {
    const content = await hashFile(opts.path);
    const source: Source = SourceSchema.parse({
      schemaVersion: 1,
      sourceId: opts.sourceId,
      addedAt: this.now().toISOString(),
      origin: { kind: "url", url: opts.url, path: opts.path },
      fingerprint: { ...content, durationMs: opts.info.durationMs ?? 0, layout: "" },
      probe: null,
      info: opts.info,
    });
    await mkdir(this.paths.analysisDir(opts.sourceId), { recursive: true });
    await writeJsonAtomic(this.paths.source(opts.sourceId), source);
    await this.updateProject((p) => {
      p.sources.push({ sourceId: opts.sourceId });
    });
    return source;
  }

  // Clips

  /** Adds a clip with no match yet. A file clip is referenced in place. */
  async addClip(clip: Omit<Clip, "match">): Promise<ClipFile> {
    const file: ClipFile = ClipFileSchema.parse({ schemaVersion: 1, ...clip, match: null });
    await mkdir(this.paths.clipAnalysisDir(clip.clipId), { recursive: true });
    await writeJsonAtomic(this.paths.clip(clip.clipId), file);
    await this.updateProject((p) => {
      if (!p.clips.includes(clip.clipId)) p.clips.push(clip.clipId);
    });
    return file;
  }

  clip(clipId: string): Promise<ClipFile> {
    return readProjectFile<ClipFile>(this.paths.clip(clipId), "clip", `clips/${clipId}/clip.json`);
  }

  /** Every clip in project order. A clip whose file is unreadable is left out. */
  async clips(): Promise<ClipFile[]> {
    const project = await this.project();
    const out: ClipFile[] = [];
    for (const clipId of project.clips) {
      try {
        out.push(await this.clip(clipId));
      } catch {
        // readProjectFile already set the bad file aside.
      }
    }
    return out;
  }

  /** The clip's media: the file itself, or the download inside the project. */
  static clipMedia(clip: Clip): string | null {
    return clip.origin.path ?? null;
  }

  updateClip(
    clipId: string,
    patch: { match?: ClipMatch | null; durationMs?: number },
  ): Promise<ClipFile> {
    return this.serial(async () => {
      const clip = await this.clip(clipId);
      const next = ClipFileSchema.parse({ ...clip, ...patch });
      await writeJsonAtomic(this.paths.clip(clipId), next);
      return next;
    });
  }

  /** Points a file source at a new path, if it's the same file. */
  relinkSource(sourceId: string, path: string): Promise<Source> {
    return this.serial(async () => {
      const source = await this.source(sourceId);
      if (source.origin.kind !== "file")
        throw new StoreError("mismatch", "Only local files can be located.");
      if (!sameContent(await hashFile(path), source.fingerprint))
        throw new StoreError("mismatch", MISMATCH_MESSAGE);
      const next = SourceSchema.parse({ ...source, origin: { ...source.origin, path } });
      await writeJsonAtomic(this.paths.source(sourceId), next);
      return next;
    });
  }

  /** Saves the probe and the full fingerprint from a finished analysis. */
  applyAnalysis(
    sourceId: string,
    result: { probe: Probe; fingerprint: Fingerprint },
  ): Promise<Source> {
    return this.serial(async () => {
      const source = await this.source(sourceId);
      const next = SourceSchema.parse({
        ...source,
        probe: result.probe,
        fingerprint: result.fingerprint,
      });
      await writeJsonAtomic(this.paths.source(sourceId), next);
      return next;
    });
  }

  // Transcript

  async transcript(sourceId: string): Promise<Transcript> {
    const path = this.paths.analysis(sourceId, "transcript.json");
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(path)).mtimeMs;
    } catch {
      throw new StoreError("missing", "This stream doesn't have a transcript yet.");
    }
    const cached = this.transcriptCache.get(sourceId);
    if (cached?.mtimeMs === mtimeMs) return cached.value;
    const value = await readProjectFile<Transcript>(
      path,
      "transcript",
      `sources/${sourceId}/analysis/transcript.json`,
    );
    this.transcriptCache.set(sourceId, { mtimeMs, value });
    return value;
  }

  /** Words and lines that overlap [fromMs, toMs). */
  async transcriptWindow(
    sourceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<TranscriptWindow> {
    const t = await this.transcript(sourceId);
    const overlaps = (a: number, b: number) => a < toMs && b > fromMs;
    return {
      sourceId,
      fromMs,
      toMs,
      words: t.words.filter((w) => overlaps(w.startMs, w.endMs)),
      lines: t.lines.filter((l) => overlaps(l.startMs, l.endMs)),
    };
  }

  /** Lines whose text contains the query, case-insensitively. At most 50. */
  async searchTranscript(sourceId: string, query: string): Promise<LineHit[]> {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const t = await this.transcript(sourceId);
    const text = new Map(t.words.map((w) => [w.id, w.text]));
    const hits: LineHit[] = [];
    for (const line of t.lines) {
      const s = line.wordIds.map((id) => text.get(id) ?? "").join(" ");
      if (s.toLowerCase().includes(q)) {
        hits.push({ lineId: line.id, startMs: line.startMs, endMs: line.endMs, text: s });
        if (hits.length === MAX_SEARCH_HITS) break;
      }
    }
    return hits;
  }

  // Shorts and versions

  shortFile(shortId: string): Promise<ShortFile> {
    return readProjectFile<ShortFile>(
      this.paths.short(shortId),
      "short",
      `shorts/${shortId}/short.json`,
    );
  }

  private async versionPath(shortId: string, n: number): Promise<string> {
    const prefix = `${String(n).padStart(4, "0")}.`;
    const names = await readdir(this.paths.versions(shortId)).catch(() => [] as string[]);
    const name = names.find((f) => f.startsWith(prefix) && /^\d{4}\.(claude|user)\.json$/.test(f));
    if (name === undefined)
      throw new StoreError("not-found", `Version ${n} of this short doesn't exist.`);
    return join(this.paths.versions(shortId), name);
  }

  /** A version, or the head with no n. */
  async version(shortId: string, n?: number): Promise<ShortVersion> {
    const target = n ?? (await this.shortFile(shortId)).head;
    const path = await this.versionPath(shortId, target);
    return readProjectFile<ShortVersion>(path, "version", `shorts/${shortId}/versions/${target}`);
  }

  async versions(shortId: string): Promise<VersionSummary[]> {
    const names = (await readdir(this.paths.versions(shortId)).catch(() => [] as string[]))
      .filter((f) => /^\d{4}\.(claude|user)\.json$/.test(f))
      .sort();
    const out: VersionSummary[] = [];
    for (const name of names) {
      const v = await readProjectFile<ShortVersion>(
        join(this.paths.versions(shortId), name),
        "version",
        name,
      );
      out.push({
        version: v.version,
        parent: v.parent,
        createdBy: v.createdBy,
        createdAt: v.createdAt,
        note: v.note,
        fromMessageId: v.fromMessageId,
      });
    }
    return out;
  }

  private async checkAgainstSource(short: Short, sourceId: string): Promise<Source> {
    const source = await this.source(sourceId);
    const issues = checkShort(
      short,
      source.probe === null ? {} : { sourceDurationMs: source.probe.durationMs },
      "short",
    );
    if (issues.length > 0) {
      const i = issues[0]!;
      throw new StoreError("bad-file", `This short isn't valid: ${i.path}: ${i.message}`);
    }
    return source;
  }

  /** A new short with its first version. */
  createShort(opts: {
    sourceId: string;
    short: Short;
    createdBy: "claude" | "user";
    note: string;
    fromMessageId: string | null;
    shortId?: string;
  }): Promise<ShortVersion> {
    return this.serial(async () => {
      const source = await this.checkAgainstSource(opts.short, opts.sourceId);
      const shortId = opts.shortId ?? newId("sh");
      const at = this.now().toISOString();
      const version = ShortVersionSchema.parse({
        schemaVersion: 1,
        shortId,
        version: 1,
        parent: null,
        createdBy: opts.createdBy,
        createdAt: at,
        fromMessageId: opts.fromMessageId,
        note: opts.note,
        sourceId: opts.sourceId,
        sourceFingerprint: fingerprintKey(source.fingerprint),
        short: opts.short,
      });
      await writeNewFileAtomic(
        this.paths.version(shortId, 1, opts.createdBy),
        `${JSON.stringify(version, null, 2)}\n`,
      );
      const file: ShortFile = ShortFileSchema.parse({
        schemaVersion: 1,
        shortId,
        sourceId: opts.sourceId,
        status: "proposed",
        head: 1,
        createdAt: at,
      });
      await writeJsonAtomic(this.paths.short(shortId), file);
      const p = await this.project();
      p.shorts.push({ shortId, head: 1 });
      await writeJsonAtomic(this.paths.project, ProjectSchema.parse(p));
      return version;
    });
  }

  /** A new version after the head. Never overwrites; deletes the draft. */
  saveVersion(
    shortId: string,
    opts: {
      short: Short;
      createdBy: "claude" | "user";
      note: string;
      fromMessageId: string | null;
      parent?: number;
    },
  ): Promise<ShortVersion> {
    return this.serial(async () => {
      const file = await this.shortFile(shortId);
      const source = await this.checkAgainstSource(opts.short, file.sourceId);
      const n = file.head + 1;
      const version = ShortVersionSchema.parse({
        schemaVersion: 1,
        shortId,
        version: n,
        parent: opts.parent ?? file.head,
        createdBy: opts.createdBy,
        createdAt: this.now().toISOString(),
        fromMessageId: opts.fromMessageId,
        note: opts.note,
        sourceId: file.sourceId,
        sourceFingerprint: fingerprintKey(source.fingerprint),
        short: opts.short,
      });
      await writeNewFileAtomic(
        this.paths.version(shortId, n, opts.createdBy),
        `${JSON.stringify(version, null, 2)}\n`,
      );
      await writeJsonAtomic(
        this.paths.short(shortId),
        ShortFileSchema.parse({
          ...file,
          head: n,
          status: opts.createdBy === "user" ? "edited" : file.status,
        }),
      );
      const p = await this.project();
      const entry = p.shorts.find((s) => s.shortId === shortId);
      if (entry !== undefined) entry.head = n;
      await writeJsonAtomic(this.paths.project, ProjectSchema.parse(p));
      await removeQuietly(this.paths.draft(shortId));
      return version;
    });
  }

  /** Restoring makes a new version that copies the old one. */
  async restore(shortId: string, n: number): Promise<ShortVersion> {
    const old = await this.version(shortId, n);
    return this.saveVersion(shortId, {
      short: old.short,
      createdBy: "user",
      note: `Restored v${n}`,
      fromMessageId: null,
      parent: n,
    });
  }

  saveDraft(shortId: string, short: Short): Promise<Draft> {
    return this.serial(async () => {
      const file = await this.shortFile(shortId);
      const draft = DraftSchema.parse({
        schemaVersion: 1,
        shortId,
        sourceId: file.sourceId,
        baseVersion: file.head,
        savedAt: this.now().toISOString(),
        short,
      });
      await writeJsonAtomic(this.paths.draft(shortId), draft);
      return draft;
    });
  }

  /** The draft, when it's newer than the head it was based on. */
  async draft(shortId: string): Promise<Draft | null> {
    if (!(await exists(this.paths.draft(shortId)))) return null;
    const draft = await readProjectFile<Draft>(
      this.paths.draft(shortId),
      "draft",
      `shorts/${shortId}/draft.json`,
    );
    const head = await this.version(shortId);
    if (draft.baseVersion !== head.version || draft.savedAt <= head.createdAt) return null;
    return draft;
  }
}
