import { describe, expect, it } from "vitest";
import {
  anthropicBody,
  anthropicProvider,
  apiModelFor,
  parseAnthropicMessage,
} from "./anthropic-api";
import { claudeArgs, claudeProvider } from "./claude-cli";
import { codexArgs, codexProvider } from "./codex-cli";
import { fakeProvider } from "./fake";
import { grokArgs, grokProvider } from "./grok-cli";
import {
  PlannerError,
  type SpawnDeps,
  type SpawnResult,
  parseStructuredOutput,
  rejectedSafeMode,
  withAgentDir,
} from "./provider";

const schema = { type: "object" };
const req = {
  instruction: "Pick shorts.",
  input: "L0001 hello",
  jsonSchema: schema,
  model: "sonnet",
  signal: new AbortController().signal,
};

function envelope(value: unknown, error = false): SpawnResult {
  return {
    code: error ? 1 : 0,
    stdout: JSON.stringify({
      type: "result",
      is_error: error,
      structured_output: error ? null : value,
    }),
    stderr: "",
  };
}

function deps(
  handler: (
    file: string,
    args: readonly string[],
    input: string,
  ) => SpawnResult | Promise<SpawnResult>,
): {
  deps: SpawnDeps;
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  let n = 0;
  const spawnDeps: SpawnDeps = {
    env: {
      ANTHROPIC_API_KEY: "sk-ant",
      XAI_API_KEY: "xai",
      OPENAI_API_KEY: "sk-oai",
      PATH: "/bin",
    },
    mkdtemp: () => {
      n += 1;
      return Promise.resolve(`/tmp/alcyo-${n}`);
    },
    writeFile: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    readFile: (path) => {
      const text = files.get(path);
      if (text === undefined) return Promise.reject(new Error("missing"));
      return Promise.resolve(text);
    },
    remove: () => Promise.resolve(),
    spawn: (file, args, opts) => Promise.resolve(handler(file, args, opts.input)),
  };
  return { deps: spawnDeps, files };
}

describe("parseStructuredOutput", () => {
  it("reads Claude's structured_output and a raw JSON value", () => {
    expect(
      parseStructuredOutput('{"type":"result","is_error":false,"structured_output":{"ok":1}}'),
    ).toEqual({
      ok: 1,
    });
    expect(parseStructuredOutput('```json\n{"ok":2}\n```')).toEqual({ ok: 2 });
    expect(() => parseStructuredOutput('{"is_error":true}')).toThrow(PlannerError);
    expect(() => parseStructuredOutput("not json")).toThrow(/didn't return JSON/);
  });

  it("reads Grok Build's envelope (recorded from grok 1.0.70) and its error", () => {
    const grok = {
      text: '{"lineIds":["L0002","L0003"],"reason":"peak"}',
      stopReason: "end_turn",
      sessionId: "01a19fd8-f26f-7e12-8864-be69cc7fb166",
      num_turns: 1,
      structuredOutput: { lineIds: ["L0002", "L0003"], reason: "peak" },
    };
    expect(parseStructuredOutput(JSON.stringify(grok))).toEqual(grok.structuredOutput);
    const { structuredOutput: _, ...noSchema } = grok;
    expect(parseStructuredOutput(JSON.stringify(noSchema))).toEqual(grok.structuredOutput);
    expect(() =>
      parseStructuredOutput('{"type":"error","message":"Couldn\'t set model \'x\'"}'),
    ).toThrow(PlannerError);
  });

  it("spots a rejected --safe-mode flag", () => {
    expect(
      rejectedSafeMode({ code: 1, stdout: "", stderr: "error: unexpected argument '--safe-mode'" }),
    ).toBe(true);
    expect(rejectedSafeMode(envelope({ ok: 1 }))).toBe(false);
  });
});

describe("claude", () => {
  it("spawns with the section 16 args, no API key, and retries without --safe-mode", async () => {
    const { deps: spawnDeps } = deps(() => envelope({ shorts: [] }));
    const calls: Array<{
      args: readonly string[];
      env: Record<string, string | undefined>;
      input: string;
    }> = [];
    spawnDeps.spawn = (_file, args, opts) => {
      calls.push({ args, env: opts.env, input: opts.input });
      if (args.includes("--safe-mode")) {
        return Promise.resolve({
          code: 1,
          stdout: "",
          stderr: "unexpected argument '--safe-mode'",
        });
      }
      return Promise.resolve(envelope({ shorts: [] }));
    };
    await expect(claudeProvider("/bin/claude", spawnDeps).complete(req)).resolves.toEqual({
      shorts: [],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toEqual(claudeArgs(req, true));
    expect(calls[1]?.args).toEqual(claudeArgs(req, false));
    expect(calls[0]?.env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(calls[0]?.env["ANTHROPIC_AUTH_TOKEN"]).toBeUndefined();
    expect(calls[0]?.input).toBe("L0001 hello");
  });
});

describe("grok and codex", () => {
  it("sends Grok one prompt file and no API key", async () => {
    const { deps: spawnDeps, files } = deps(() => envelope({ ok: true }));
    const calls: Array<{ args: readonly string[]; env: Record<string, string | undefined> }> = [];
    spawnDeps.spawn = (_file, args, opts) => {
      calls.push({ args, env: opts.env });
      return Promise.resolve(envelope({ ok: true }));
    };
    await expect(grokProvider("/bin/grok", spawnDeps).complete(req)).resolves.toEqual({ ok: true });
    const prompt = "/tmp/alcyo-1/prompt.txt";
    expect(calls[0]?.args).toEqual(grokArgs(prompt, schema));
    expect(files.get(prompt)).toBe("Pick shorts.\n\nL0001 hello");
    expect(calls[0]?.env["XAI_API_KEY"]).toBeUndefined();
  });

  it("asks Codex for a schema file and reads the last message", async () => {
    const { deps: spawnDeps, files } = deps(() => ({ code: 0, stdout: "", stderr: "" }));
    const calls: Array<{
      args: readonly string[];
      env: Record<string, string | undefined>;
      input: string;
    }> = [];
    spawnDeps.spawn = (_file, args, opts) => {
      calls.push({ args, env: opts.env, input: opts.input });
      files.set("/tmp/alcyo-1/last.txt", '{"ok":3}');
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    await expect(codexProvider("/bin/codex", spawnDeps).complete(req)).resolves.toEqual({ ok: 3 });
    expect(calls[0]?.args).toEqual(
      codexArgs("/tmp/alcyo-1/schema.json", "/tmp/alcyo-1/last.txt", "/tmp/alcyo-1"),
    );
    expect(calls[0]?.args).toContain("read-only");
    expect(calls[0]?.env["OPENAI_API_KEY"]).toBeUndefined();
    expect(calls[0]?.input).toContain("L0001 hello");
    expect(JSON.parse(files.get("/tmp/alcyo-1/schema.json") ?? "")).toEqual(schema);
  });
});

describe("anthropic API", () => {
  it("sends the schema as structured output, never a forced tool, and reads the text", async () => {
    let header = "";
    const fetchImpl: typeof fetch = (_url, init) => {
      header = new Headers(init?.headers).get("x-api-key") ?? "";
      const raw = init?.body;
      if (typeof raw !== "string") throw new Error("expected a string body");
      const body = JSON.parse(raw) as Record<string, unknown>;
      expect(body).toEqual(anthropicBody(req));
      expect(body["model"]).toBe("claude-sonnet-5-5");
      expect(body["output_config"]).toEqual({ format: { type: "json_schema", schema } });
      expect(body).not.toHaveProperty("tool_choice");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"ok":4}' }],
          }),
          { status: 200 },
        ),
      );
    };
    await expect(anthropicProvider("sk-test", fetchImpl).complete(req)).resolves.toEqual({ ok: 4 });
    expect(header).toBe("sk-test");
  });

  it("maps Claude Code aliases to API model ids and keeps full ids", () => {
    expect(apiModelFor("sonnet")).toBe("claude-sonnet-5-5");
    expect(apiModelFor("opus")).toBe("claude-opus-5-5");
    expect(apiModelFor("claude-haiku-5-5")).toBe("claude-haiku-5-5");
  });

  it("fails on a refusal or a cut-off answer", () => {
    const text = [{ type: "text", text: '{"ok":1}' }];
    expect(() => parseAnthropicMessage({ stop_reason: "refusal", content: text })).toThrow(
      PlannerError,
    );
    expect(() => parseAnthropicMessage({ stop_reason: "max_tokens", content: text })).toThrow(
      PlannerError,
    );
    expect(() =>
      parseAnthropicMessage({ content: [{ type: "text", text: "Sure, here you go" }] }),
    ).toThrow(PlannerError);
  });

  it("fails without putting the key in the message", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response("nope sk-test", { status: 401 }));
    const error = await anthropicProvider("sk-test", fetchImpl)
      .complete(req)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(PlannerError);
    expect(error instanceof Error ? error.message : "").not.toContain("sk-test");
  });
});

describe("withAgentDir", () => {
  it("puts the agent's folder first so an env-node script finds node", () => {
    const env = withAgentDir(
      { PATH: "/usr/bin:/bin", HOME: "/h" },
      "/opt/homebrew/bin/codex",
      "darwin",
    );
    expect(env).toEqual({ PATH: "/opt/homebrew/bin:/usr/bin:/bin", HOME: "/h" });
  });

  it("keeps Windows' Path casing and doesn't repeat the folder", () => {
    const env = withAgentDir(
      { Path: "C:\\Windows;C:\\Users\\me\\.local\\bin" },
      "C:\\Users\\me\\.local\\bin\\codex.exe",
      "win32",
    );
    expect(env).toEqual({ Path: "C:\\Users\\me\\.local\\bin;C:\\Windows" });
  });
});

describe("fake", () => {
  it("returns the canned value", async () => {
    await expect(fakeProvider({ ok: true }).complete(req)).resolves.toEqual({ ok: true });
  });
});
