// Runs scripts/build-demo.ts. The workspace packages and main's services are
// TypeScript with extensionless imports, so esbuild bundles them first (as
// packages/mcp does) and Node runs the bundle.
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const desktop = resolve(import.meta.dirname, "..");
const outfile = join(desktop, "out", "demo", "build-demo.mjs");

await build({
  entryPoints: [join(desktop, "scripts", "build-demo.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: [
      'import { createRequire as __alcyoRequire } from "node:module";',
      "const require = __alcyoRequire(import.meta.url);",
    ].join("\n"),
  },
  external: ["electron"],
  logLevel: "warning",
});

const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ALCYO_REPO: resolve(desktop, "..", "..") },
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
