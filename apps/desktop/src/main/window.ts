import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

/** Window options. Exported so a test can pin the security settings. */
export function windowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Alcyo Shorts",
    backgroundColor: "#0B0B0B",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  };
}

/** The URL the window loads: the dev server in dev, the bundled file when built. */
export function rendererUrl(mainDir: string): string {
  const dev = process.env["ELECTRON_RENDERER_URL"];
  if (dev !== undefined && dev.length > 0) return dev;
  return pathToFileURL(join(mainDir, "..", "renderer", "index.html")).href;
}

function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.protocol === y.protocol && x.host === y.host && x.pathname === y.pathname;
  } catch {
    return false;
  }
}

export function createMainWindow(mainDir: string): BrowserWindow {
  const url = rendererUrl(mainDir);
  const win = new BrowserWindow(windowOptions(join(mainDir, "..", "preload", "index.cjs")));

  // No new windows, no navigating away, no webviews.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!samePage(target, url)) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  win.once("ready-to-show", () => win.show());
  void win.loadURL(url);
  return win;
}
