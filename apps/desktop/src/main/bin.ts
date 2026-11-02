import { join } from "node:path";

/** fetch-binaries target name for this OS and CPU, e.g. "mac-arm64". */
export function binTarget(platform: NodeJS.Platform, arch: string): string {
  return `${platform === "darwin" ? "mac" : platform === "win32" ? "win" : platform}-${arch}`;
}

/**
 * Where the bundled tools live: process.resourcesPath/bin when packaged, and
 * ALCYO_BIN_DIR (or apps/desktop/resources/bin/<target> from fetch-binaries) in
 * dev. appDir is apps/desktop, found from main's own folder (out/main), because
 * app.getAppPath() is out/main when Electron is started on the built script.
 */
export function resolveBinDir(opts: {
  packaged: boolean;
  resourcesPath: string;
  appDir: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: string;
}): string {
  if (opts.packaged) return join(opts.resourcesPath, "bin");
  const override = opts.env["ALCYO_BIN_DIR"];
  if (override !== undefined && override.length > 0) return override;
  return join(opts.appDir, "resources", "bin", binTarget(opts.platform, opts.arch));
}
