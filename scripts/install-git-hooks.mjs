#!/usr/bin/env node
// Writes .git/hooks/pre-commit so commits with media outside examples/demo/
// are refused. It doesn't change git config. Run with: pnpm hooks:install
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const hooksDir = resolve(
  execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8" }).trim(),
);
const file = join(hooksDir, "pre-commit");
const MARK = "# alcyo: check-no-media";
const script = `#!/bin/sh\n${MARK}\nexec node scripts/check-no-media.mjs --staged\n`;

if (existsSync(file) && !readFileSync(file, "utf8").includes(MARK)) {
  console.error(`${file} already exists and isn't ours. Add this line to it instead:`);
  console.error("  node scripts/check-no-media.mjs --staged || exit 1");
  process.exit(1);
}
writeFileSync(file, script);
chmodSync(file, 0o755);
console.log(`Installed ${file}`);
