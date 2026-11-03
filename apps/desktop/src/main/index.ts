// Electron main: lifecycle, single instance, alcyo:// links, IPC, worker host.
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { applyApiKey, CHANNELS, type SetupRequest, type WhisperModelName } from "@alcyo/ipc";
import { probeAgent, providerForAgent } from "@alcyo/planner";
import { LINK_SCHEME, type LocalAgentId } from "@alcyo/schema";
import { SettingsFile, StreamsIndex } from "@alcyo/store";
import { app, BrowserWindow, dialog, safeStorage, shell } from "electron";
import pkg from "../../package.json";
import { resolveBinDir } from "./bin";
import { handle, sendEvent } from "./ipc";
import { createHandlers } from "./ipc/handlers";
import { findLinkInArgv, LinkQueue, linkEvent } from "./links";
import { ApiKeyFile } from "./api-key";
import { fixtureKind, fixtureReport } from "./setup-fixture";
import { SetupService } from "./setup-service";
import { StreamService } from "./streams";
import { createMainWindow, isHeadless, rendererUrl } from "./window";
import { downloadWhisperModel } from "./whisper-download";
import { WorkerHost } from "./worker-host";
import { realSetupDeps } from "../worker/exec";

const mainDir = import.meta.dirname;

// Tests run against a throwaway profile.
const userDataOverride = process.env["ALCYO_USER_DATA"];
if (userDataOverride !== undefined && userDataOverride.length > 0) {
  app.setPath("userData", userDataOverride);
}

// Headless runs (tests, screenshots) show nothing, not even a Dock icon.
if (isHeadless() && process.platform === "darwin") app.dock?.hide();

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the window; it gets our argv through second-instance.
  app.quit();
} else {
  run();
}

function envPath(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.length > 0 ? value : undefined;
}

function run(): void {
  const links = new LinkQueue();
  const worker = new WorkerHost();
  let win: BrowserWindow | undefined;

  const focus = () => {
    if (win === undefined || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  };

  const deliver = (url: string) => {
    focus();
    const message = linkEvent(url);
    if (message.event === "link:open") sendEvent(win, message.event, message.payload);
    else sendEvent(win, message.event, message.payload);
  };

  // Register the scheme with the OS. Dev runs don't, so a dev Electron never
  // becomes the system's alcyo:// handler. Packaged builds also declare it in
  // Info.plist (macOS) and through the nsis installer (Windows).
  if (app.isPackaged) app.setAsDefaultProtocolClient(LINK_SCHEME);

  // macOS delivers links here, possibly before ready.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    links.push(url);
  });

  // Windows and Linux deliver links as argv to a second instance...
  app.on("second-instance", (_event, argv) => {
    focus();
    const url = findLinkInArgv(argv);
    if (url !== undefined) links.push(url);
  });

  // ...and as argv on a cold start.
  if (process.platform !== "darwin") {
    const first = findLinkInArgv(process.argv);
    if (first !== undefined) links.push(first);
  }

  const openWindow = () => {
    const created = createMainWindow(mainDir);
    win = created;
    created.webContents.on("did-finish-load", () => links.attach(deliver));
    created.on("closed", () => {
      links.detach();
      if (win === created) win = undefined;
    });
  };

  void app.whenReady().then(() => {
    const platform = process.platform as "darwin" | "win32" | "linux";
    const userData = app.getPath("userData");
    const paths = {
      userData,
      // Tests point these at throwaway (or real) folders.
      models: envPath("ALCYO_MODELS_DIR") ?? join(userData, "models"),
      streams: envPath("ALCYO_STREAMS_DIR") ?? join(app.getPath("videos"), "Alcyo Shorts"),
      bin: resolveBinDir({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appDir: join(mainDir, "..", ".."),
        env: process.env,
        platform: process.platform,
        arch: process.arch,
      }),
    };
    const setupRequest: SetupRequest = {
      binDir: paths.bin,
      modelsDir: paths.models,
      platform,
      arch: process.arch,
    };
    const fixture = fixtureKind(process.env, isHeadless());
    const settings = new SettingsFile(userData, platform);
    const apiKey = new ApiKeyFile(join(userData, "anthropic-key.bin"), {
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (blob) => safeStorage.decryptString(blob),
    });
    const setup = new SetupService(async () => {
      if (fixture !== null) return fixtureReport(fixture, setupRequest, new Date());
      const current = await settings.read();
      const report = await worker.get().setupCheck({
        ...setupRequest,
        saved: {
          provider: current.provider,
          claudePath: current.claudePath,
          grokPath: current.grokPath,
          codexPath: current.codexPath,
        },
      });
      return applyApiKey(report, await apiKey.has());
    });
    let download: Promise<{ path: string; name: WhisperModelName }> | undefined;
    const exe = (name: string) => join(paths.bin, platform === "win32" ? `${name}.exe` : name);
    const streams = new StreamService({
      index: new StreamsIndex(userData),
      settings,
      defaultStreamsDir:
        envPath("ALCYO_STREAMS_DIR") ?? join(app.getPath("videos"), "Alcyo Shorts"),
      worker: () => worker.get(),
      analysisBase: async () => {
        const [current, report] = await Promise.all([settings.read(), setup.get()]);
        const version = (name: string) =>
          report.tools.find((t) => t.name === name)?.version ?? "unknown";
        const modelPath = join(paths.models, `ggml-${current.whisperModel}.bin`);
        const vadDir = join(paths.bin, "models");
        const vad = existsSync(vadDir)
          ? readdirSync(vadDir).find((f) => f.startsWith("ggml-silero"))
          : undefined;
        return {
          tools: { ffmpeg: exe("ffmpeg"), ffprobe: exe("ffprobe"), whisper: exe("whisper-cli") },
          toolVersions: { ffmpeg: version("ffmpeg"), whisper: version("whisper-cli") },
          model: existsSync(modelPath) ? { path: modelPath, name: current.whisperModel } : null,
          vadModel: join(vadDir, vad ?? "ggml-silero-v6.2.0.bin"),
          mode: "full",
          encoder: current.encoder,
          threads: Math.max(1, Math.min(8, availableParallelism() - 1)),
        };
      },
      chooseVideo: async () => {
        const options: Electron.OpenDialogOptions = {
          title: "Choose a recording",
          properties: ["openFile"],
          filters: [
            {
              name: "Videos",
              extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "flv", "ts"],
            },
            { name: "All files", extensions: ["*"] },
          ],
        };
        const result =
          win === undefined || win.isDestroyed()
            ? await dialog.showOpenDialog(options)
            : await dialog.showOpenDialog(win, options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      emit: (event, payload) => sendEvent(win, event, payload),
    });

    const handlers = createHandlers({
      appInfo: () => ({
        // From package.json, so unpackaged runs (where Electron reports its
        // own name and version) show the same as the packaged app.
        name: pkg.productName,
        version: pkg.version,
        platform,
        arch: process.arch,
        electron: process.versions.electron ?? "unknown",
        chrome: process.versions.chrome ?? "unknown",
        node: process.versions.node,
      }),
      appPaths: async () => ({
        ...paths,
        streams: (await settings.read()).streamsDir ?? paths.streams,
      }),
      openDataFolder: async () => {
        await mkdir(userData, { recursive: true });
        const error = await shell.openPath(userData);
        if (error.length > 0) throw new Error(`Couldn't open the data folder: ${error}`);
      },
      setupCheck: (fresh) => setup.get(fresh),
      locateAgent: async (id: LocalAgentId) => {
        const options: Electron.OpenDialogOptions = {
          title: "Locate the agent",
          properties: ["openFile"],
        };
        const picked =
          win === undefined || win.isDestroyed()
            ? await dialog.showOpenDialog(options)
            : await dialog.showOpenDialog(win, options);
        const path = picked.canceled ? null : (picked.filePaths[0] ?? null);
        if (path === null) return { cancelled: true };
        const hit = await probeAgent(id, path, realSetupDeps());
        if (hit.path === null) {
          return {
            rejected: true,
            message: "That file didn't run. Pick the agent program itself.",
          };
        }
        const saved =
          id === "claude"
            ? { claudePath: hit.path, provider: providerForAgent(id) }
            : id === "grok"
              ? { grokPath: hit.path, provider: providerForAgent(id) }
              : { codexPath: hit.path, provider: providerForAgent(id) };
        await settings.patch(saved);
        return { path: hit.path };
      },
      downloadModel: () => {
        if (download !== undefined) return download;
        const run = settings.read().then((current) =>
          downloadWhisperModel({
            name: current.whisperModel,
            modelsDir: paths.models,
            onProgress: (received, total) => sendEvent(win, "model:progress", { received, total }),
          }).then((path) => ({ path, name: current.whisperModel })),
        );
        download = run;
        run.then(
          () => {
            if (download === run) download = undefined;
          },
          () => {
            if (download === run) download = undefined;
          },
        );
        return run;
      },
      setApiKey: async (key) => {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error("This computer can't store a key safely.");
        }
        await mkdir(userData, { recursive: true });
        await apiKey.write(key);
      },
      clearApiKey: () => apiKey.clear(),
      pingWorker: (text) => worker.get().ping(text),
      now: () => performance.now(),
      streams,
    });
    const appUrl = () => rendererUrl(mainDir);
    for (const channel of CHANNELS) {
      // Each handler's types come from its channel; the loop just registers them.
      handle(channel, handlers[channel] as never, appUrl);
    }

    worker.start();
    // Start the first check now, so the window rarely has to wait for it.
    setup.get().catch(() => undefined);
    openWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => worker.stop());
}
