---
inclusion: fileMatch
fileMatchPattern: ["apps/desktop/src/main/**/*.ts", "apps/desktop/src/preload/**/*.ts", "apps/desktop/src/worker/**/*.ts"]
---
# Electron notes

- BrowserWindow: contextIsolation, sandbox, nodeIntegration false. CSP:
  script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:. No remote content.
- requestSingleInstanceLock. alcyo:// via setAsDefaultProtocolClient;
  macOS open-url, Windows second-instance argv. Parse with the schema
  link parser before sending link:open to the renderer.
- Every ipcMain.handle goes through handle(channel, fn) with the channel's
  Zod schema. Worker messages are checked the same way.
- Jobs run in the utilityProcess. Progress goes to the window and into the
  stream's thread as a status message. Every job can be cancelled.
- alcyo-media:// (standard, secure, stream: true) via protocol.handle
  serves only the open projects' cache, sources, clips and resources/fonts,
  and answers Range requests (206).
- Binaries in process.resourcesPath/bin; in dev, ALCYO_BIN_DIR.
- path.join and app.getPath; never hardcode / or \.
