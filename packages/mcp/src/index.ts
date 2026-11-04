// Entry point: node packages/mcp/dist/index.js --root examples [--bin <dir>] [--fonts <dir>]
// Speaks MCP over stdio. Logs go to stderr; stdout is the protocol.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

const repo = resolve(import.meta.dirname, "..", "..", "..");
const target = `${process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : process.platform}-${process.arch}`;

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    bin: { type: "string" },
    fonts: { type: "string" },
  },
});

const root = resolve(values.root ?? "examples");
const binDir = resolve(
  values.bin ??
    process.env["ALCYO_BIN_DIR"] ??
    join(repo, "apps", "desktop", "resources", "bin", target),
);
const fontsDir = resolve(values.fonts ?? join(repo, "apps", "desktop", "resources", "fonts"));

if (!existsSync(root))
  console.error(
    `[alcyo-mcp] The root folder ${root} doesn't exist yet. Tools will say so until it does.`,
  );
if (!existsSync(binDir))
  console.error(
    `[alcyo-mcp] No ffmpeg folder at ${binDir}. Run pnpm fetch-binaries, or pass --bin.`,
  );

const server = createServer({ root, binDir, fontsDir });
await server.connect(new StdioServerTransport());
console.error(`[alcyo-mcp] Serving ${root}`);
