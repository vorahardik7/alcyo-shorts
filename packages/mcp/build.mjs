// Bundles the server into dist/index.js, one file Node runs directly
// (plan section 27). The workspace packages are TypeScript sources, so
// esbuild bundles them in.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  // Some bundled CommonJS (ajv in the MCP SDK) calls require().
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __alcyoRequire } from "node:module";',
      "const require = __alcyoRequire(import.meta.url);",
    ].join("\n"),
  },
  // This server never runs inside Electron.
  external: ["electron"],
  logLevel: "warning",
});
