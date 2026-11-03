// Update downloader (plan section 11). Sites change and an old yt-dlp stops
// working, so Settings can fetch the newest release. The new file is kept
// only when its SHA-256 matches the release's SHA2-256SUMS and it runs. The
// bundled copy is never touched and is used whenever the update is missing.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  LATEST_RELEASE,
  Release,
  compareVersions,
  parseSha256Sums,
  pickAsset,
} from "@alcyo/import";
import type { DownloaderInfo } from "@alcyo/ipc";
import { type SettingsFile, exists, renameInto } from "@alcyo/store";

const MAX_BYTES = 200 * 1024 * 1024;
const HEADERS = { accept: "application/vnd.github+json", "user-agent": "Alcyo-Shorts" };

export interface DownloaderDeps {
  settings: SettingsFile;
  /** userData/bin: where an updated copy goes. */
  userBinDir: string;
  /** The yt-dlp in the app's bin folder. */
  bundledPath: string;
  platform: NodeJS.Platform;
  fetch?: typeof fetch;
  /** `yt-dlp --version`, or null when it doesn't run. */
  versionOf: (path: string) => Promise<string | null>;
}

export class Downloader {
  private bundledVersion: Promise<string | null> | undefined;
  private updating: Promise<DownloaderInfo> | undefined;

  constructor(private readonly deps: DownloaderDeps) {}

  /** The updated copy when it's there, otherwise the bundled one. */
  async path(): Promise<string> {
    const saved = (await this.deps.settings.read()).ytDlp;
    if (saved.path !== null && (await exists(saved.path))) return saved.path;
    return this.deps.bundledPath;
  }

  async info(note?: string): Promise<DownloaderInfo> {
    this.bundledVersion ??= this.deps.versionOf(this.deps.bundledPath);
    const bundled = await this.bundledVersion;
    const saved = (await this.deps.settings.read()).ytDlp;
    const updated = saved.path !== null && (await exists(saved.path));
    return {
      version: updated ? saved.version : bundled,
      bundled,
      updated,
      path: updated && saved.path !== null ? saved.path : this.deps.bundledPath,
      ...(note === undefined ? {} : { note }),
    };
  }

  update(): Promise<DownloaderInfo> {
    this.updating ??= this.run().finally(() => {
      this.updating = undefined;
    });
    return this.updating;
  }

  async useBundled(): Promise<DownloaderInfo> {
    const saved = (await this.deps.settings.read()).ytDlp;
    await this.deps.settings.patch({ ytDlp: { version: null, path: null } });
    if (saved.path !== null) await rm(saved.path, { force: true }).catch(() => undefined);
    return this.info("Using the bundled downloader.");
  }

  private async run(): Promise<DownloaderInfo> {
    const fetchImpl = this.deps.fetch ?? fetch;
    const current = await this.info();
    let release: Release;
    try {
      const response = await fetchImpl(LATEST_RELEASE, { headers: HEADERS });
      if (!response.ok) throw new Error(String(response.status));
      release = Release.parse(await response.json());
    } catch {
      throw new Error("Couldn't check for a new downloader. Check your connection and try again.");
    }
    if (current.version !== null && compareVersions(release.tag_name, current.version) <= 0) {
      return this.info(`${current.version} is the newest version.`);
    }
    const asset = pickAsset(release, this.deps.platform);
    if (asset === null) throw new Error("That release has no downloader for this computer.");

    let sha: string | undefined;
    try {
      const sums = await fetchImpl(asset.sums, {
        headers: { "user-agent": HEADERS["user-agent"] },
      });
      if (!sums.ok) throw new Error(String(sums.status));
      sha = parseSha256Sums(await sums.text()).get(asset.name);
    } catch {
      throw new Error("Couldn't get the release's checksums. Nothing was changed.");
    }
    if (sha === undefined) throw new Error("The release doesn't list a checksum for this file.");

    const exe = this.deps.platform === "win32" ? ".exe" : "";
    const dest = join(this.deps.userBinDir, `yt-dlp-${release.tag_name}${exe}`);
    const partial = `${dest}.partial`;
    await mkdir(this.deps.userBinDir, { recursive: true });
    try {
      const response = await fetchImpl(asset.binary, {
        headers: { "user-agent": HEADERS["user-agent"] },
      });
      if (!response.ok || response.body === null) throw new Error(String(response.status));
      // GitHub redirects to its file host; the end of the redirect must still be https.
      if (response.url !== "" && !response.url.startsWith("https://")) throw new Error("not https");
      const hash = createHash("sha256");
      let bytes = 0;
      const count = new Transform({
        transform(chunk: Buffer, _enc, done) {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            done(new Error("too big"));
            return;
          }
          hash.update(chunk);
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), count, createWriteStream(partial));
      if (hash.digest("hex") !== sha) {
        throw new Error("The download didn't match the release's checksum. Nothing was changed.");
      }
      const handle = await open(partial, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (this.deps.platform !== "win32") await chmod(partial, 0o755);
      await renameInto(partial, dest);
    } catch (error) {
      await rm(partial, { force: true });
      if (error instanceof Error && error.message.includes("checksum")) throw error;
      throw new Error("The new downloader didn't download. Nothing was changed.", {
        cause: error,
      });
    }

    const version = await this.deps.versionOf(dest);
    if (version === null) {
      await rm(dest, { force: true });
      throw new Error("The new downloader didn't run, so the bundled one stays in use.");
    }
    const previous = (await this.deps.settings.read()).ytDlp.path;
    await this.deps.settings.patch({ ytDlp: { version, path: dest } });
    if (previous !== null && previous !== dest)
      await rm(previous, { force: true }).catch(() => undefined);
    return this.info(`Updated to ${version}.`);
  }
}
