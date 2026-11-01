import { describe, expect, it } from "vitest";
import { contract, events } from "./contract";
import { CHANNELS, EVENTS, isChannel, isEventName } from "./names";
import { MainToWorker, WorkerToMain } from "./worker";

describe("names", () => {
  it("match the contract exactly", () => {
    expect([...CHANNELS].sort()).toEqual(Object.keys(contract).sort());
    expect([...EVENTS].sort()).toEqual(Object.keys(events).sort());
  });

  it("guard unknown names", () => {
    expect(isChannel("app:info")).toBe(true);
    expect(isChannel("fs:read")).toBe(false);
    expect(isChannel(42)).toBe(false);
    expect(isEventName("link:open")).toBe(true);
    expect(isEventName("link:close")).toBe(false);
  });
});

describe("contract", () => {
  it("rejects extra-long ping text", () => {
    expect(contract["worker:ping"].input.safeParse({ text: "x".repeat(1001) }).success).toBe(false);
  });

  it("checks link:open payloads with the link schema", () => {
    expect(events["link:open"].safeParse({ link: { to: "renders" } }).success).toBe(true);
    expect(events["link:open"].safeParse({ link: { to: "elsewhere" } }).success).toBe(false);
  });
});

describe("worker messages", () => {
  it("accept the known shapes", () => {
    expect(MainToWorker.parse({ type: "ping", id: "1", text: "hi" })).toEqual({
      type: "ping",
      id: "1",
      text: "hi",
    });
    expect(WorkerToMain.parse({ type: "ready" })).toEqual({ type: "ready" });
  });

  it("reject unknown types and missing ids", () => {
    expect(MainToWorker.safeParse({ type: "exec", cmd: "rm" }).success).toBe(false);
    expect(MainToWorker.safeParse({ type: "ping", text: "hi" }).success).toBe(false);
    expect(WorkerToMain.safeParse({ type: "pong", id: "", text: "x" }).success).toBe(false);
  });
});
