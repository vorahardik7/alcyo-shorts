// Electron main: lifecycle, single instance, alcyo:// links, IPC, worker host.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SetupRequest } from "@alcyo/ipc";
import { LINK_SCHEME } from "@alcyo/schema";
import { app, BrowserWindow, shell } from "electron";
import pkg from "../../package.json";
import { resolveBinDir } from "./bin";
import { handle, sendEvent } from "./ipc";
import { createHandlers } from "./ipc/handlers";
import { findLinkInArgv, LinkQueue, linkEvent } from "./links";
import { fixtureKind, fixtureReport } from "./setup-fixture";
import { SetupService } from "./setup-service";
import { createMainWindow, isHeadless, rendererUrl } from "./window";
import { WorkerHost } from "./worker-host";

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
      models: join(userData, "models"),
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
    const setup = new SetupService(() =>
      fixture === null
        ? worker.get().setupCheck(setupRequest)
        : Promise.resolve(fixtureReport(fixture, setupRequest, new Date())),
    );

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
      appPaths: () => paths,
      openDataFolder: async () => {
        await mkdir(userData, { recursive: true });
        const error = await shell.openPath(userData);
        if (error.length > 0) throw new Error(`Couldn't open the data folder: ${error}`);
      },
      setupCheck: (fresh) => setup.get(fresh),
      pingWorker: (text) => worker.get().ping(text),
      now: () => performance.now(),
    });
    const appUrl = () => rendererUrl(mainDir);
    handle("app:info", handlers["app:info"], appUrl);
    handle("app:paths", handlers["app:paths"], appUrl);
    handle("shell:openDataFolder", handlers["shell:openDataFolder"], appUrl);
    handle("setup:check", handlers["setup:check"], appUrl);
    handle("worker:ping", handlers["worker:ping"], appUrl);

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
