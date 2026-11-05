import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

/**
 * Headless mode (ALCYO_HEADLESS=1): e2e tests and screenshot runs. The window
 * is created and painted but never shown, so nothing pops up on screen.
 */
export function isHeadless(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["ALCYO_HEADLESS"] === "1";
}

/** Window options. Exported so a test can pin the security settings. */
export function windowOptions(
  preloadPath: string,
  headless = false,
): BrowserWindowConstructorOptions {
  return {
    ...(headless ? { paintWhenInitiallyHidden: true, skipTaskbar: true } : {}),
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Alcyo Shorts",
    backgroundColor: "#0E0F11",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Centered in the sidebar's 52 px top bar (lights are 14 px tall).
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 16, y: 19 } } : {}),
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
      // A hidden window would otherwise stop painting and running timers.
      backgroundThrottling: !headless,
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
  const headless = isHeadless();
  const win = new BrowserWindow(
    windowOptions(join(mainDir, "..", "preload", "index.cjs"), headless),
  );

  // No new windows, no navigating away, no webviews.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!samePage(target, url)) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  if (!headless) win.once("ready-to-show", () => win.show());
  void win.loadURL(url);
  return win;
}
