#!/usr/bin/env node
// Kiro PostFileSave hook: fix lint and format issues in the one .ts/.tsx file
// that was just saved. The path comes from the hook's stdin JSON. This never
// lints the whole repo.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { logHookEvent, parsePayload, readStdin } from "./hook-log.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Finds the saved file's path in a hook payload. Kiro sends `file_path`; the
 * other names are fallbacks in case a client differs.
 * @param {Record<string, unknown>} payload
 * @returns {string | undefined}
 */
export function savedPath(payload) {
  const input = /** @type {Record<string, unknown>} */ (
    typeof payload["tool_input"] === "object" && payload["tool_input"] !== null
      ? payload["tool_input"]
      : {}
  );
  const paths = payload["paths"];
  const candidates = [
    payload["file_path"],
    payload["filePath"],
    payload["path"],
    input["path"],
    input["file_path"],
    Array.isArray(paths) ? paths[0] : undefined,
  ];
  return /** @type {string | undefined} */ (
    candidates.find((c) => typeof c === "string" && c.length > 0)
  );
}

/**
 * Resolves the path inside the repo, or returns a reason to skip it.
 * @param {string | undefined} path
 * @param {string} root
 * @param {string} cwd
 * @returns {{ file: string } | { skip: string }}
 */
export function target(path, root, cwd) {
  if (path === undefined) return { skip: "no file path in the hook payload" };
  const file = isAbsolute(path) ? path : resolve(cwd, path);
  const rel = relative(root, file);
  if (rel.startsWith("..") || isAbsolute(rel)) return { skip: "file is outside the repo" };
  if (!/\.(ts|tsx)$/.test(file)) return { skip: "not a .ts or .tsx file" };
  if (/(^|[\\/])(node_modules|out|dist|release)[\\/]/.test(rel))
    return { skip: "generated or vendored file" };
  return { file };
}

async function main() {
  const payload = parsePayload(await readStdin());
  const path = savedPath(payload);
  const cwd = typeof payload["cwd"] === "string" ? payload["cwd"] : process.cwd();
  const t = target(path, ROOT, cwd);
  logHookEvent(ROOT, {
    hook: "lint-on-save",
    event: payload["hook_event_name"],
    keys: Object.keys(payload),
    path,
    ...("skip" in t ? { skipped: t.skip } : {}),
  });
  if ("skip" in t || !existsSync(t.file)) return;

  // .cmd shims on Windows can't be spawned without a shell, so run the JS
  // entry points with node instead.
  /** @param {string} entry @param {string[]} args */
  const run = (entry, args) =>
    spawnSync(process.execPath, [entry, ...args], { cwd: ROOT, encoding: "utf8" });
  const eslint = run(join(ROOT, "node_modules", "eslint", "bin", "eslint.js"), [
    "--fix",
    "--no-warn-ignored",
    t.file,
  ]);
  const prettier = run(join(ROOT, "node_modules", "prettier", "bin", "prettier.cjs"), [
    "--write",
    "--log-level",
    "warn",
    t.file,
  ]);

  const rel = relative(ROOT, t.file);
  if (eslint.status !== 0 || prettier.status !== 0) {
    process.stderr.write(
      `Lint problems left in ${rel}:\n${eslint.stdout}${eslint.stderr}${prettier.stderr}`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Linted and formatted ${rel}.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
