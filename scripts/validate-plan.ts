// pnpm plan:validate [paths...]
// Checks project files (plan section 15) against the Zod schemas, their
// migrations and checks. With no paths it checks examples/. Run from the
// validate-project-files hook, it also checks the saved file named in the
// hook's stdin. Prints file, path and reason for each problem; exits 1 if any
// file is bad.
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkShort,
  type Draft,
  fileKindOf,
  type Issue,
  parseProjectFile,
  type ShortVersion,
  Source,
  Transcript,
} from "../packages/schema/src/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "cache", ".turbo", "out", "dist", "release"]);
const STDIN_WAIT_MS = 300;

export interface FileReport {
  file: string;
  issues: Issue[];
}

async function walk(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(path, out);
    } else if (entry.isFile() && fileKindOf(path) !== null) out.push(path);
  }
}

/** The project folder a file sits in: the nearest ancestor with a project.json. */
function projectRoot(file: string): string | null {
  let dir = dirname(file);
  for (;;) {
    if (existsSync(join(dir, "project.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** A version or draft checked against its source's length and transcript, when they're there. */
function contextIssues(file: string, sourceId: string, short: ShortVersion["short"]): Issue[] {
  const root = projectRoot(file);
  if (root === null) return [];
  const sourceDir = join(root, "sources", sourceId);
  const source = Source.safeParse(readJson(join(sourceDir, "source.json")));
  const transcript = Transcript.safeParse(readJson(join(sourceDir, "analysis", "transcript.json")));
  const duration = source.success ? source.data.probe?.durationMs : undefined;
  if (duration === undefined && !transcript.success) return [];
  return checkShort(
    short,
    {
      ...(duration === undefined ? {} : { sourceDurationMs: duration }),
      ...(transcript.success ? { wordIds: new Set(transcript.data.words.map((w) => w.id)) } : {}),
    },
    "short",
  );
}

export function validateFile(file: string): FileReport {
  const kind = fileKindOf(file);
  if (kind === null) return { file, issues: [] };
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return {
      file,
      issues: [{ path: "(file)", message: `Couldn't read it: ${(error as Error).message}` }],
    };
  }
  const parsed = parseProjectFile(kind, text);
  const issues = [...parsed.issues];
  if (parsed.value !== null && issues.length === 0 && (kind === "version" || kind === "draft")) {
    const v = parsed.value as ShortVersion | Draft;
    issues.push(...contextIssues(file, v.sourceId, v.short));
  }
  return { file, issues };
}

export async function validate(
  roots: readonly string[],
  extra: readonly string[] = [],
): Promise<FileReport[]> {
  const files: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (statSync(root).isDirectory()) await walk(root, files);
    else if (fileKindOf(root) !== null) files.push(root);
  }
  for (const file of extra) {
    if (existsSync(file) && fileKindOf(file) !== null) files.push(file);
  }
  const unique = [...new Set(files.map((f) => resolve(f)))].sort();
  return unique.map(validateFile);
}

/** The saved file from a Kiro hook payload on stdin, if there is one. */
export function hookFilePath(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  const path = p["file_path"] ?? p["filePath"];
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((done) => {
    let data = "";
    const finish = () => {
      process.stdin.pause();
      done(data);
    };
    const timer = setTimeout(finish, STDIN_WAIT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => (data += chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

export function formatReport(
  reports: readonly FileReport[],
  cwd: string,
  rootsLabel: string,
): string {
  const bad = reports.filter((r) => r.issues.length > 0);
  const lines: string[] = [];
  for (const r of bad) {
    const name = relative(cwd, r.file) || basename(r.file);
    for (const issue of r.issues) lines.push(`${name}: ${issue.path}: ${issue.message}`);
  }
  if (reports.length === 0) lines.push(`No project files found in ${rootsLabel}.`);
  else if (bad.length === 0)
    lines.push(
      `${reports.length} project ${reports.length === 1 ? "file" : "files"} checked. All good.`,
    );
  else
    lines.push(
      `${bad.length} of ${reports.length} project ${reports.length === 1 ? "file has" : "files have"} problems.`,
    );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const roots = args.length > 0 ? args.map((a) => resolve(a)) : [join(ROOT, "examples")];
  const extra: string[] = [];
  const stdin = await readStdin();
  if (stdin.trim().length > 0) {
    try {
      const path = hookFilePath(JSON.parse(stdin));
      if (path !== undefined) extra.push(resolve(path));
    } catch {
      // Not hook JSON; ignore it.
    }
  }
  const reports = await validate(roots, extra);
  const label = args.length > 0 ? args.join(", ") : "examples/";
  const out = formatReport(reports, process.cwd(), label);
  const bad = reports.some((r) => r.issues.length > 0);
  (bad ? console.error : console.log)(out);
  process.exitCode = bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
