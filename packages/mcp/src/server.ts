// The MCP server for Kiro (plan sections 23 spec 12 and 27). Registers the
// seven tools with their Zod input schemas. Read-only tools say so in their
// annotations; render_short writes into the stream's renders folder.
import { join } from "node:path";
import { runTool, type Runner } from "@alcyo/media";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Root, ToolError } from "./root.ts";
import { type ToolContext, type ToolName, inputs, tools } from "./tools.ts";

export interface ServerOptions {
  root: string;
  /** Folder with ffmpeg and ffprobe. */
  binDir: string;
  /** resources/fonts, the bundled caption fonts. */
  fontsDir: string;
  run?: Runner;
}

const DESCRIPTIONS: Record<ToolName, string> = {
  probe_video: "Reads a video file's length, size, frame rate and codecs with ffprobe.",
  open_project:
    "Opens a stream folder: its sources, clips, shorts and thread size. Without a folder, lists the stream folders under the root.",
  list_shorts:
    "Lists a stream's shorts with their latest version, segments, length and version history.",
  get_transcript_window:
    "Returns transcript lines and words (with ids and ms times) for a range of a source.",
  get_thread: "Returns a stream's chat thread, newest last.",
  validate_version:
    "Checks a saved version: its file, segment order and range, crop keys, hook, caption word ids, the source fingerprint and its looks. Returns every issue found.",
  render_short:
    "Renders a version to a 1080 x 1920 MP4 in the stream's renders folder with the bundled ffmpeg and fonts, checks it with ffprobe, and records it. Returns the file and the ffprobe summary.",
};

const READ_ONLY: readonly ToolName[] = [
  "probe_video",
  "open_project",
  "list_shorts",
  "get_transcript_window",
  "get_thread",
  "validate_version",
];

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

export function createServer(opts: ServerOptions): McpServer {
  const ctx: ToolContext = {
    root: new Root(opts.root),
    ffmpeg: join(opts.binDir, exe("ffmpeg")),
    ffprobe: join(opts.binDir, exe("ffprobe")),
    fontsDir: opts.fontsDir,
    run: opts.run ?? runTool,
  };
  const server = new McpServer(
    { name: "alcyo", version: "0.1.0" },
    {
      instructions: "Alcyo Shorts projects under one root folder. Paths are relative to that root.",
    },
  );
  for (const name of Object.keys(tools) as ToolName[]) {
    const readOnly = READ_ONLY.includes(name);
    server.registerTool(
      name,
      {
        description: DESCRIPTIONS[name],
        inputSchema: inputs[name],
        annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
      },
      async (args: unknown) => {
        try {
          const run = tools[name] as (
            c: ToolContext,
            a: unknown,
          ) => Promise<Record<string, unknown>>;
          const value = await run(ctx, args);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
            structuredContent: value,
          };
        } catch (error) {
          const text =
            error instanceof ToolError
              ? error.message
              : `The ${name} tool stopped: ${error instanceof Error ? error.message : String(error)}`;
          return { content: [{ type: "text" as const, text }], isError: true };
        }
      },
    );
  }
  return server;
}
