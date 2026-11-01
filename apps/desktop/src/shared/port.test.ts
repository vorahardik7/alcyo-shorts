import { MessageChannel, type MessagePort } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerClient, type PortLike, serveWorker } from "./port";

const open: MessagePort[] = [];

function nodePort(port: MessagePort): PortLike {
  open.push(port);
  return {
    send: (message) => port.postMessage(message),
    onMessage: (listener) => port.on("message", listener),
  };
}

afterEach(() => {
  for (const port of open.splice(0)) port.close();
});

describe("worker protocol over a MessagePort", () => {
  it("round-trips one checked ping", async () => {
    const { port1, port2 } = new MessageChannel();
    serveWorker(nodePort(port1), () => undefined);
    const client = createWorkerClient(nodePort(port2));
    await client.ready;
    await expect(client.ping("hello")).resolves.toBe("hello");
  });

  it("answers a malformed request with an error and never acts on it", async () => {
    const { port1, port2 } = new MessageChannel();
    const logs: string[] = [];
    serveWorker(nodePort(port1), (m) => logs.push(m));
    const replies: unknown[] = [];
    port2.on("message", (m) => replies.push(m));
    open.push(port2);
    port2.postMessage({ type: "exec", id: "7", cmd: "rm -rf /" });
    await new Promise((r) => setTimeout(r, 20));
    expect(replies).toContainEqual({ type: "ready" });
    expect(replies).toContainEqual({
      type: "error",
      id: "7",
      message: "The worker got a message it doesn't understand.",
    });
    expect(logs.length).toBe(1);
  });

  it("drops malformed replies on the main side", async () => {
    const { port1, port2 } = new MessageChannel();
    const logs: string[] = [];
    const client = createWorkerClient(nodePort(port2), { timeoutMs: 50, log: (m) => logs.push(m) });
    open.push(port1);
    port1.on("message", (m: { id: string }) => port1.postMessage({ type: "pong", id: m.id }));
    await expect(client.ping("x")).rejects.toThrow("didn't answer in time");
    expect(logs.length).toBeGreaterThan(0);
  });

  it("rejects pending and later calls after close", async () => {
    const { port1, port2 } = new MessageChannel();
    open.push(port1);
    const client = createWorkerClient(nodePort(port2));
    const call = client.ping("x");
    client.close("The worker stopped.");
    await expect(call).rejects.toThrow("The worker stopped.");
    await expect(client.ping("y")).rejects.toThrow("The worker stopped.");
  });
});
