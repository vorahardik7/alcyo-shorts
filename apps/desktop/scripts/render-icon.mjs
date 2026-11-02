// Renders build/icon.svg to build/icon.png (1024 px) with offscreen Electron.
// Run: pnpm --filter @alcyo/desktop icon. electron-builder makes the .icns
// and .ico from the PNG. Nothing is shown on screen.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const dir = join(import.meta.dirname, "..", "build");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;

if (process.platform === "darwin") app.dock?.hide();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const { width } = image.getSize();
  const png = (width === 1024 ? image : image.resize({ width: 1024, quality: "best" })).toPNG();
  writeFileSync(join(dir, "icon.png"), png);
  console.log(`Wrote ${join(dir, "icon.png")} (${png.length} bytes)`);
  app.quit();
});
