import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

// Plan section 18 and electron.md. Nothing remote.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self'",
  "img-src 'self' data: blob: alcyo-media:",
  "media-src 'self' blob: alcyo-media:",
  "font-src 'self' alcyo-media:",
  "connect-src 'self' alcyo-media:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

// The Vite dev server needs inline React refresh code, so the CSP meta tag is
// only added to built (and packaged) pages.
function cspMeta(): Plugin {
  return {
    name: "alcyo-csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
        injectTo: "head-prepend",
      },
    ],
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/preload/index.ts") },
        // Sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    plugins: [react(), tailwindcss(), cspMeta()],
    server: {
      fs: { allow: [resolve(import.meta.dirname, "../..")] },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/renderer/index.html") },
      },
    },
  },
});
