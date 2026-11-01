#!/usr/bin/env node
// Fails if git tracks (or, with --staged, is about to commit) a video or audio
// file outside examples/demo/. Used by CI and the pre-commit hook.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isForbiddenMedia } from "./media-extensions.mjs";

/** @param {string[]} paths */
export function forbiddenPaths(paths) {
  return paths.filter((p) => p.length > 0 && isForbiddenMedia(p));
}

/** @param {{ staged: boolean, cwd?: string }} opts */
export function listPaths({ staged, cwd }) {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "-z"];
  const out = execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0");
}

function main() {
  const staged = process.argv.includes("--staged");
  const bad = forbiddenPaths(listPaths({ staged }));
  if (bad.length === 0) {
    console.log(
      staged
        ? "No media staged outside examples/demo/."
        : "No media tracked outside examples/demo/.",
    );
    return;
  }
  console.error(
    `${staged ? "These video or audio files are staged" : "Git tracks these video or audio files"} outside examples/demo/:`,
  );
  for (const p of bad) console.error(`  ${p}`);
  console.error(
    staged
      ? "Unstage them with: git restore --staged <file>"
      : "Remove them from git with: git rm --cached <file>",
  );
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
