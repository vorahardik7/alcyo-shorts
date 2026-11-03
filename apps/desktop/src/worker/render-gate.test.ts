import { describe, expect, it } from "vitest";
import { RenderGate } from "./render-gate";

describe("RenderGate", () => {
  it("holds background steps until the last render ends", async () => {
    const gate = new RenderGate();
    await gate.idle();
    let finish!: () => void;
    const render = gate.during(() => new Promise<void>((r) => (finish = r)));
    let passed = false;
    const waiting = gate.idle().then(() => (passed = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(passed).toBe(false);
    finish();
    await render;
    await waiting;
    expect(passed).toBe(true);
  });

  it("opens even when the render fails", async () => {
    const gate = new RenderGate();
    await expect(gate.during(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await gate.idle();
  });
});
