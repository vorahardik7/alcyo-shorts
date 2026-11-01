import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

const { windowOptions, rendererUrl } = await import("./window");

describe("windowOptions", () => {
  it("locks the renderer down", () => {
    const prefs = windowOptions("/x/preload/index.cjs").webPreferences!;
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.nodeIntegrationInWorker).toBe(false);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.webviewTag).toBe(false);
    expect(prefs.preload).toBe("/x/preload/index.cjs");
  });
});

describe("rendererUrl", () => {
  it("points at the bundled page when there's no dev server", () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "");
    const url = rendererUrl(join("app", "out", "main"));
    expect(url).toBe(pathToFileURL(join("app", "out", "renderer", "index.html")).href);
    expect(url.endsWith("/app/out/renderer/index.html")).toBe(true);
    vi.unstubAllEnvs();
  });
});
