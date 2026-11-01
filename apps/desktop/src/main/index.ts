// Electron main: lifecycle, single instance, alcyo:// links, IPC, worker host.
import { LINK_SCHEME } from "@alcyo/schema";
import { app, BrowserWindow } from "electron";
import { handle, sendEvent } from "./ipc";
import { createHandlers } from "./ipc/handlers";
import { findLinkInArgv, LinkQueue, linkEvent } from "./links";
import { createMainWindow, rendererUrl } from "./window";
import { WorkerHost } from "./worker-host";

const mainDir = import.meta.dirname;

// Tests run against a throwaway profile.
const userDataOverride = process.env["ALCYO_USER_DATA"];
if (userDataOverride !== undefined && userDataOverride.length > 0) {
  app.setPath("userData", userDataOverride);
}

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
    const handlers = createHandlers({
      appInfo: () => ({
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform as "darwin" | "win32" | "linux",
        arch: process.arch,
        electron: process.versions.electron ?? "unknown",
      }),
      pingWorker: (text) => worker.get().ping(text),
      now: () => performance.now(),
    });
    const appUrl = () => rendererUrl(mainDir);
    handle("app:info", handlers["app:info"], appUrl);
    handle("worker:ping", handlers["worker:ping"], appUrl);

    worker.start();
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
