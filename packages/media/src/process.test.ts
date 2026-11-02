import { describe, expect, it } from "vitest";
import { MediaError } from "./errors.ts";
import { runTool } from "./process.ts";

const node = process.execPath;

describe("runTool", () => {
  it("passes args to the child unchanged, with no shell in between", async () => {
    const awkward = [`a "quoted" arg`, "it's", "$HOME", "名前 — ok", "; rm -rf /", "-v"];
    const out = await runTool(
      node,
      ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...awkward],
      {
        collectStdout: true,
      },
    );
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(awkward);
  });

  it("streams lines and keeps a stderr tail", async () => {
    const lines: string[] = [];
    const out = await runTool(
      node,
      [
        "-e",
        "for (let i = 0; i < 60; i++) console.error('e' + i); console.log('a\\nb'); process.exit(3)",
      ],
      { onStdoutLine: (l) => lines.push(l) },
    );
    expect(out.code).toBe(3);
    expect(lines).toEqual(["a", "b"]);
    expect(out.stderrTail).toHaveLength(40);
    expect(out.stderrTail.at(-1)).toBe("e59");
  });

  it("kills the child when cancelled, and rejects with cancelled", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = runTool(node, ["-e", "setInterval(() => {}, 1000)"], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("rejects at once when already cancelled, and plainly when the tool is missing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runTool(node, ["-v"], { signal: controller.signal })).rejects.toBeInstanceOf(
      MediaError,
    );
    await expect(runTool("/no/such/tool", [], {})).rejects.toMatchObject({ code: "tool-failed" });
  });
});
