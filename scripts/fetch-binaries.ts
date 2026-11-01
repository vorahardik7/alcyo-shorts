#!/usr/bin/env node
// Fetches or builds the pinned tools for one target, verifies every checksum,
// and places them in apps/desktop/resources/bin/<target>/ for extraResources.
//
//   node scripts/fetch-binaries.ts [--target mac-arm64|win-x64] [--verify]
//
// --verify downloads nothing; it checks the folder against the lock and the
// manifest written by the last fetch. Packaging runs it first.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  ChecksumError,
  checksumMessage,
  hostTarget,
  isTarget,
  lockHash,
  type Manifest,
  Manifest as ManifestSchema,
  outputsOf,
  parseLock,
  type Target,
  type Tool,
  verifyProblems,
} from "./lib/binaries.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "binaries");
// ALCYO_BINARIES_LOCK lets a test point at a different lock file.
const LOCK_PATH = process.env["ALCYO_BINARIES_LOCK"] ?? join(ROOT, "scripts", "binaries.lock.json");
const binDir = (target: Target) => join(ROOT, "apps", "desktop", "resources", "bin", target);

function args(): { target: Target; verify: boolean } {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--target");
  const requested = at === -1 ? undefined : argv[at + 1];
  const target = requested ?? hostTarget(process.platform, process.arch);
  if (target === undefined || !isTarget(target)) {
    throw new Error(
      `No target for ${process.platform}-${process.arch}. Pass --target mac-arm64 or --target win-x64.`,
    );
  }
  return { target, verify: argv.includes("--verify") };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

function run(cmd: string, cmdArgs: string[], cwd?: string): void {
  const result = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
  if (result.error !== undefined) throw new Error(`Couldn't run ${cmd}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed (exit ${result.status}).`);
}

/** Downloads into the cache (or reuses a cached copy) and verifies the checksum. */
async function download(tool: Tool): Promise<string> {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, `${tool.sha256.slice(0, 12)}-${basename(new URL(tool.url).pathname)}`);
  if (existsSync(file) && (await sha256File(file)) === tool.sha256) return file;

  console.log(`  downloading ${tool.url}`);
  const response = await fetch(tool.url, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed (${response.status} ${response.statusText}): ${tool.url}`);
  }
  const part = `${file}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
  const actual = await sha256File(part);
  if (actual !== tool.sha256) {
    await rename(part, `${file}.bad`);
    throw new ChecksumError(checksumMessage(file, tool.url, tool.sha256, actual));
  }
  await rename(part, file);
  return file;
}

async function place(from: string, out: string, rel: string, target: Target): Promise<void> {
  const dest = join(out, rel);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(from, dest);
  if (target === "mac-arm64" && !rel.endsWith(".bin")) await chmod(dest, 0o755);
}

async function extract(archive: string, into: string): Promise<void> {
  await rm(into, { recursive: true, force: true });
  await mkdir(into, { recursive: true });
  // bsdtar reads zip and tar.gz on macOS and on Windows 10+.
  run("tar", ["-xf", archive, "-C", into]);
}

async function install(name: string, tool: Tool, target: Target, out: string): Promise<void> {
  console.log(`${name} ${tool.version}`);
  const archive = await download(tool);
  switch (tool.kind) {
    case "file":
      await place(archive, out, tool.output, target);
      if (tool.executable === true && target === "mac-arm64")
        await chmod(join(out, tool.output), 0o755);
      return;
    case "archive": {
      const dir = join(CACHE, `x-${tool.sha256.slice(0, 12)}`);
      await extract(archive, dir);
      for (const [from, to] of Object.entries(tool.extract)) {
        const src = join(dir, from);
        if (!existsSync(src))
          throw new Error(
            `${from} isn't in ${basename(archive)}. Check the lock entry for ${name}.`,
          );
        await place(src, out, to, target);
      }
      await rm(dir, { recursive: true, force: true });
      return;
    }
    case "cmake": {
      if (process.platform !== "darwin" || target !== "mac-arm64") {
        throw new Error(`${name} is built from source and can only be built on macOS.`);
      }
      // Keyed by the whole lock entry, so changed CMake flags rebuild.
      const work = join(CACHE, `build-${lockHash(tool).slice(0, 12)}`);
      const src = join(work, tool.sourceDir);
      const built = Object.keys(tool.built).map((rel) => join(src, rel));
      if (!built.every((p) => existsSync(p))) {
        await extract(archive, work);
        console.log(`  building ${tool.cmakeTarget} with CMake (a few minutes the first time)`);
        run("cmake", ["-S", src, "-B", join(src, "build"), ...tool.cmakeArgs]);
        run("cmake", [
          "--build",
          join(src, "build"),
          "--config",
          "Release",
          "--target",
          tool.cmakeTarget,
          "-j",
        ]);
      }
      for (const [from, to] of Object.entries(tool.built))
        await place(join(src, from), out, to, target);
      return;
    }
  }
}

/** Runs each tool once to show it starts, when the target matches this machine. */
function smokeTest(out: string, target: Target): void {
  const exe = target === "win-x64" ? ".exe" : "";
  const checks: Array<[string, string[]]> = [
    [`ffmpeg${exe}`, ["-hide_banner", "-version"]],
    [`ffprobe${exe}`, ["-hide_banner", "-version"]],
    [`yt-dlp${exe}`, ["--version"]],
    [`whisper-cli${exe}`, ["--help"]],
  ];
  for (const [bin, binArgs] of checks) {
    const result = spawnSync(join(out, bin), binArgs, { encoding: "utf8", timeout: 60_000 });
    const first = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .split("\n")
      .find((l) => l.trim() !== "");
    if (result.error !== undefined || result.status !== 0) {
      throw new Error(
        `${bin} didn't run: ${result.error?.message ?? `exit ${result.status}`}\n${first ?? ""}`,
      );
    }
    console.log(`  ok ${bin}: ${first?.trim()}`);
  }
}

function readManifest(out: string): Manifest | undefined {
  const file = join(out, "manifest.json");
  if (!existsSync(file)) return undefined;
  const parsed = ManifestSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  return parsed.success ? parsed.data : undefined;
}

function shaSync(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function main(): Promise<void> {
  const { target, verify } = args();
  const lock = parseLock(JSON.parse(await readFile(LOCK_PATH, "utf8")));
  const tools = lock.targets[target];
  const out = binDir(target);

  if (verify) {
    const problems = verifyProblems(tools, readManifest(out), (rel) => shaSync(join(out, rel)));
    if (problems.length > 0) {
      console.error(`Bundled tools for ${target} aren't ready:`);
      for (const p of problems) console.error(`  ${p}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Bundled tools for ${target} match scripts/binaries.lock.json.`);
    return;
  }

  console.log(`Fetching tools for ${target} into ${out}`);
  // Build into a staging folder so a failure leaves the current tools alone.
  const staging = `${out}.partial`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  const manifest: Manifest = { target, tools: {} };
  for (const [name, tool] of Object.entries(tools)) {
    await install(name, tool, target, staging);
    const files: Record<string, string> = {};
    for (const rel of outputsOf(tool)) files[rel] = await sha256File(join(staging, rel));
    manifest.tools[name] = { version: tool.version, lockHash: lockHash(tool), files };
  }
  await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  if (hostTarget(process.platform, process.arch) === target) smokeTest(staging, target);
  await rm(out, { recursive: true, force: true });
  await rename(staging, out);
  console.log(`Done. ${Object.keys(tools).length} tools for ${target} are in place.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
