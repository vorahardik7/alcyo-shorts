// Which schema a project file uses, and parsing one from its text with its
// migrations and own checks. Used by plan:validate and, later, the store.
import type { z } from "zod";
import {
  checkProfile,
  checkShort,
  checkTranscript,
  checkVersion,
  type Issue,
  zodIssues,
} from "./checks.ts";
import { ClipFile } from "./clip.ts";
import { Message } from "./message.ts";
import { type FileKind, migrate } from "./migrate.ts";
import { CreatorProfile } from "./profile.ts";
import { PresetFile, Template } from "./presets.ts";
import { Project, RenderIndex, Settings, StreamsIndex } from "./project.ts";
import { Draft, ShortFile, ShortVersion } from "./short.ts";
import { Source } from "./source.ts";
import { AnalysisSteps, Loudness, Scenes, Silences, Transcript } from "./transcript.ts";

export type ProjectFileKind = FileKind | "messages";

const BY_NAME: Record<string, FileKind> = {
  "project.json": "project",
  "short.json": "short",
  "draft.json": "draft",
  "clip.json": "clip",
  "source.json": "source",
  "transcript.json": "transcript",
  "silences.json": "silences",
  "scenes.json": "scenes",
  "loudness.json": "loudness",
  "steps.json": "steps",
  "preset.json": "preset",
  "settings.json": "settings",
  "streams.json": "streams",
};

/** The kind of project file at a path, by its name, or null if it isn't one. */
export function fileKindOf(path: string): ProjectFileKind | null {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1) ?? "";
  if (name === "messages.jsonl") return "messages";
  if (/^\d{4}\.(claude|user)\.json$/.test(name)) return "version";
  if (name.endsWith(".alcyo-template.json")) return "template";
  if (name === "profile.json" || name.endsWith("-profile.json")) return "profile";
  if (name.endsWith(".preset.json")) return "preset";
  if (name === "index.json" && parts.at(-2) === "renders") return "renders";
  return BY_NAME[name] ?? null;
}

const SCHEMAS: Record<FileKind, z.ZodType> = {
  project: Project,
  short: ShortFile,
  draft: Draft,
  version: ShortVersion,
  clip: ClipFile,
  source: Source,
  transcript: Transcript,
  silences: Silences,
  scenes: Scenes,
  loudness: Loudness,
  steps: AnalysisSteps,
  profile: CreatorProfile,
  preset: PresetFile,
  template: Template,
  settings: Settings,
  streams: StreamsIndex,
  renders: RenderIndex,
};

/** The checks a file can run on its own, without other files. */
function ownChecks(kind: FileKind, value: unknown): Issue[] {
  switch (kind) {
    case "version":
      return checkVersion(value as ShortVersion);
    case "draft":
      return checkShort((value as Draft).short, {}, "short");
    case "transcript":
      return checkTranscript(value as Transcript);
    case "profile":
      return checkProfile(value as CreatorProfile);
    case "template": {
      const range = (value as Template).targetLengthMs;
      return range === undefined
        ? []
        : checkProfile({ lengthMs: range }).map((i) => ({ ...i, path: "targetLengthMs" }));
    }
    default:
      return [];
  }
}

export interface ParsedFile {
  kind: ProjectFileKind;
  /** The parsed value, or null when it didn't parse. For messages, the list of messages. */
  value: unknown;
  issues: Issue[];
}

function parseMessages(text: string): ParsedFile {
  const issues: Issue[] = [];
  const messages: Message[] = [];
  const lines = text.split("\n");
  // A file that doesn't end in a newline may have a torn last line from a
  // crash mid-write; the store drops it, so it isn't an error here either.
  const tornLast = !text.endsWith("\n");
  lines.forEach((line, i) => {
    if (line.trim().length === 0) return;
    const isLast = i === lines.length - 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      if (!(isLast && tornLast)) issues.push({ path: `line ${i + 1}`, message: "Not valid JSON." });
      return;
    }
    const parsed = Message.safeParse(raw);
    if (parsed.success) messages.push(parsed.data);
    else issues.push(...zodIssues(parsed.error, `line ${i + 1}`));
  });
  return { kind: "messages", value: messages, issues };
}

export function parseProjectFile(kind: ProjectFileKind, text: string): ParsedFile {
  if (kind === "messages") return parseMessages(text);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      kind,
      value: null,
      issues: [{ path: "(file)", message: `Not valid JSON: ${(error as Error).message}` }],
    };
  }
  const migrated = migrate(kind, raw);
  if (!migrated.ok)
    return { kind, value: null, issues: [{ path: "schemaVersion", message: migrated.reason }] };
  const parsed = SCHEMAS[kind].safeParse(migrated.value);
  if (!parsed.success) return { kind, value: null, issues: zodIssues(parsed.error) };
  return { kind, value: parsed.data, issues: ownChecks(kind, parsed.data) };
}
