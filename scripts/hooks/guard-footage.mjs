#!/usr/bin/env node
// Kiro PreToolUse hook on shell tools. Exits 2 (block) with a reason when a
// command looks like it uploads video or audio, streams it out with ffmpeg, or
// `git add`s media outside examples/demo/. One of three layers with the
// pre-commit hook and the CI check (scripts/check-no-media.mjs).
//
// It matches command patterns. A program that uploads from inside its own code
// gets past it; the git layers still stop media reaching the repo.
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isForbiddenMedia, isMediaPath } from "../media-extensions.mjs";
import { logHookEvent, parsePayload, readStdin } from "./hook-log.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Splits a shell command line into simple commands (token lists), honouring
 * quotes and escapes, and breaking on ; & | && || and newlines. Redirections
 * (<, >) become their own tokens.
 * @param {string} line
 * @returns {string[][]}
 */
export function splitCommands(line) {
  /** @type {string[][]} */
  const commands = [];
  /** @type {string[]} */
  let tokens = [];
  let current = "";
  let inToken = false;
  /** @type {"'" | '"' | null} */
  let quote = null;

  const endToken = () => {
    if (inToken) tokens.push(current);
    current = "";
    inToken = false;
  };
  const endCommand = () => {
    endToken();
    if (tokens.length > 0) commands.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1] ?? ""))
        current += line[++i];
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
    } else if (ch === "\\" && i + 1 < line.length) {
      current += line[++i];
      inToken = true;
    } else if (
      ch === ";" ||
      ch === "&" ||
      ch === "|" ||
      ch === "\n" ||
      ch === "(" ||
      ch === ")" ||
      ch === "`"
    ) {
      endCommand();
    } else if (ch === "<" || ch === ">") {
      endToken();
      tokens.push(ch);
    } else if (ch === " " || ch === "\t" || ch === "\r") {
      endToken();
    } else if (ch === "$" && line[i + 1] === "(") {
      endCommand();
      i++;
    } else {
      current += ch;
      inToken = true;
    }
  }
  endCommand();
  return commands;
}

const WRAPPERS = new Set([
  "sudo",
  "command",
  "exec",
  "nohup",
  "time",
  "nice",
  "env",
  "xargs",
  "npx",
  "pnpx",
  "bunx",
]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "pwsh", "powershell", "cmd"]);

/**
 * Strips env assignments, wrappers and paths, returning [program, ...args].
 * @param {string[]} tokens
 * @returns {string[]}
 */
function normalize(tokens) {
  let rest = [...tokens];
  for (;;) {
    while (rest.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0] ?? "")) rest = rest.slice(1);
    const head =
      (rest[0] ?? "")
        .split(/[\\/]/)
        .pop()
        ?.toLowerCase()
        .replace(/\.exe$/, "") ?? "";
    if (WRAPPERS.has(head)) {
      rest = rest.slice(1);
      while (rest.length > 0 && (rest[0] ?? "").startsWith("-")) rest = rest.slice(1);
      continue;
    }
    return [head, ...rest.slice(1)];
  }
}

/** @param {string[]} args */
const mediaArgs = (args) =>
  args.filter((a) => isMediaPath(a.replace(/^[^=]*=@?/, "").replace(/^[@<]/, "")));
const NETWORK_URL = /^(rtmps?|rtsp|srt|udp|tcp|rtp|icecast|https?|s?ftp):\/\//i;
const DIRECT_UPLOADERS = new Set([
  "scp",
  "rsync",
  "sftp",
  "rclone",
  "gsutil",
  "ftp",
  "lftp",
  "nc",
  "ncat",
  "netcat",
  "croc",
  "magic-wormhole",
  "wormhole",
]);

/**
 * @typedef {{ wouldAdd(args: string[], cwd: string): string[] }} Deps
 * @typedef {{ cwd: string, root: string, deps: Deps, depth: number }} Ctx
 */

/**
 * @param {string[]} tokens
 * @param {Ctx} ctx
 * @returns {string | null} a reason to block, or null
 */
function checkSimple(tokens, ctx) {
  const [program = "", ...args] = normalize(tokens);
  const media = mediaArgs(args);

  if (SHELLS.has(program)) {
    const at = args.findIndex(
      (a) =>
        a === "-c" ||
        a === "-lc" ||
        a === "-ilc" ||
        /^-\w*c$/.test(a) ||
        a === "/c" ||
        a === "-Command",
    );
    const script = at === -1 ? undefined : args[at + 1];
    if (script !== undefined && ctx.depth < 3)
      return checkLine(script, { ...ctx, depth: ctx.depth + 1 });
    return null;
  }
  if (program === "eval" && ctx.depth < 3)
    return checkLine(args.join(" "), { ...ctx, depth: ctx.depth + 1 });

  if (DIRECT_UPLOADERS.has(program) && media.length > 0) {
    return `${program} would send video or audio (${media[0]}) off this computer.`;
  }

  if (program === "curl") {
    const uploadFlag = args.some(
      (a) =>
        /^(-T|--upload-file|-F|--form|--form-string|-d|--data|--data-binary|--data-raw|--data-urlencode|--json)(=|$)/.test(
          a,
        ) ||
        /^-[a-zA-Z]*T/.test(a) ||
        /^-F./.test(a) ||
        /^-d@/.test(a),
    );
    if (uploadFlag && media.length > 0) return `curl would upload video or audio (${media[0]}).`;
  }

  if (program === "wget" && args.some((a) => /^--(post|body)-file/.test(a)) && media.length > 0) {
    return `wget would upload video or audio (${media[0]}).`;
  }

  if (
    (program === "http" || program === "https" || program === "xh") &&
    args.some((a) => /@/.test(a)) &&
    media.length > 0
  ) {
    return `${program} would upload video or audio (${media[0]}).`;
  }

  if (program === "aws" && media.length > 0)
    return `aws would upload video or audio (${media[0]}).`;
  if (program === "az" && args[0] === "storage" && media.length > 0)
    return `az storage would upload video or audio (${media[0]}).`;
  if (program === "gh" && (args[0] === "release" || args[0] === "gist") && media.length > 0) {
    return `gh ${args[0]} would publish video or audio (${media[0]}).`;
  }

  if (program === "ffmpeg") {
    const output = args.find((a, i) => NETWORK_URL.test(a) && args[i - 1] !== "-i");
    if (output !== undefined) return `ffmpeg would stream video or audio to ${output}.`;
  }

  if (program === "git") return checkGit(args, ctx);
  return null;
}

/** Git options that take a value, before the subcommand. */
const GIT_VALUE_OPTS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
]);

/**
 * @param {string[]} args
 * @param {Ctx} ctx
 * @returns {string | null}
 */
function checkGit(args, ctx) {
  let i = 0;
  let cwd = ctx.cwd;
  while (i < args.length && (args[i] ?? "").startsWith("-")) {
    const opt = args[i] ?? "";
    if (GIT_VALUE_OPTS.has(opt)) {
      if (opt === "-C" && args[i + 1] !== undefined) cwd = resolve(cwd, args[i + 1] ?? "");
      i += 2;
    } else i += 1;
  }
  if (args[i] !== "add") return null;
  const addArgs = args.slice(i + 1);
  const paths = addArgs.filter((a) => !a.startsWith("-"));

  /** @param {string} p */
  const inRepo = (p) => {
    const rel = relative(ctx.root, isAbsolute(p) ? p : resolve(cwd, p));
    return rel.replaceAll("\\", "/");
  };
  const named = paths.find((p) => isForbiddenMedia(inRepo(p)));
  if (named !== undefined) {
    return `git add would stage video or audio outside examples/demo/ (${named}). Media stays out of git.`;
  }

  // For ".", "-A", folders and globs, ask git what would actually be staged.
  /** @type {string[]} */
  let wouldAdd;
  try {
    wouldAdd = ctx.deps.wouldAdd(addArgs, cwd);
  } catch {
    return null; // git refused the command; it won't stage anything.
  }
  const hit = wouldAdd.find((p) => isForbiddenMedia(inRepo(p)));
  return hit === undefined
    ? null
    : `git add would stage video or audio outside examples/demo/ (${hit}). Media stays out of git.`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string | null}
 */
function checkLine(line, ctx) {
  for (const tokens of splitCommands(line)) {
    const reason = checkSimple(tokens, ctx);
    if (reason !== null) return reason;
  }
  return null;
}

/**
 * @param {string} command
 * @param {{ cwd?: string, root?: string, deps?: Deps }} [opts]
 * @returns {string | null} a reason to block, or null to allow
 */
export function checkCommand(command, opts = {}) {
  const root = opts.root ?? ROOT;
  return checkLine(command, { cwd: opts.cwd ?? root, root, deps: opts.deps ?? gitDeps, depth: 0 });
}

/** @type {Deps} */
export const gitDeps = {
  wouldAdd(args, cwd) {
    const out = execFileSync(
      "git",
      [
        "add",
        "--dry-run",
        "--ignore-missing",
        ...args.filter((a) => a !== "-n" && a !== "--dry-run"),
      ],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      },
    );
    return out
      .split("\n")
      .map((l) => /^add '(.*)'$/.exec(l)?.[1])
      .filter(/** @returns {p is string} */ (p) => p !== undefined);
  },
};

/**
 * Pulls the shell command out of a PreToolUse payload.
 * @param {Record<string, unknown>} payload
 * @returns {string | undefined}
 */
export function commandOf(payload) {
  const input = payload["tool_input"];
  if (typeof input === "string") return input;
  if (typeof input !== "object" || input === null) return undefined;
  const record = /** @type {Record<string, unknown>} */ (input);
  const found = ["command", "cmd", "script", "commandLine"]
    .map((k) => record[k])
    .find((v) => typeof v === "string");
  return /** @type {string | undefined} */ (found);
}

async function main() {
  const payload = parsePayload(await readStdin());
  const command = commandOf(payload);
  const cwd = typeof payload["cwd"] === "string" ? payload["cwd"] : process.cwd();
  const reason = command === undefined ? null : checkCommand(command, { cwd });
  logHookEvent(ROOT, {
    hook: "guard-footage",
    event: payload["hook_event_name"],
    tool: payload["tool_name"],
    keys: Object.keys(payload),
    inputKeys:
      typeof payload["tool_input"] === "object" && payload["tool_input"] !== null
        ? Object.keys(payload["tool_input"])
        : [],
    command,
    blocked: reason !== null,
  });
  if (reason !== null) {
    process.stderr.write(
      `Blocked by guard-footage: ${reason}\nVideo and audio never leave this computer or go into git (outside examples/demo/).\n`,
    );
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
