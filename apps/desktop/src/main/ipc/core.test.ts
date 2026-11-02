import { describe, expect, it, vi } from "vitest";
import { checkEvent, isTrustedSenderUrl, makeHandler } from "./core";

describe("makeHandler", () => {
  it("runs the handler with parsed input", async () => {
    const fn = vi.fn((input: { text: string }) => ({ text: input.text, ms: 1 }));
    const run = makeHandler("worker:ping", fn);
    await expect(run({ text: "hi" })).resolves.toEqual({ text: "hi", ms: 1 });
    expect(fn).toHaveBeenCalledWith({ text: "hi" });
  });

  it.each([undefined, null, "hi", { text: 5 }, { text: "x".repeat(1001) }])(
    "rejects bad input %j without running the handler",
    async (raw) => {
      const fn = vi.fn(() => ({ text: "", ms: 0 }));
      const run = makeHandler("worker:ping", fn);
      await expect(run(raw)).rejects.toThrow("worker:ping: bad input");
      expect(fn).not.toHaveBeenCalled();
    },
  );

  it("rejects a bad answer from the handler", async () => {
    const run = makeHandler("app:info", () => ({ name: "x" }) as never);
    await expect(run({})).rejects.toThrow("app:info: the app produced a bad answer");
  });

  it("checks app:info output", async () => {
    const info = {
      name: "Alcyo Shorts",
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      electron: "45.2.1",
      chrome: "142.0.0.0",
      node: "24.11.0",
    } as const;
    await expect(makeHandler("app:info", () => info)({})).resolves.toEqual(info);
  });
});

describe("checkEvent", () => {
  it("passes valid payloads and throws on invalid ones", () => {
    expect(checkEvent("link:open", { link: { to: "settings" } })).toEqual({
      link: { to: "settings" },
    });
    expect(() => checkEvent("link:open", { link: { to: "nowhere" } } as never)).toThrow();
  });
});

describe("isTrustedSenderUrl", () => {
  const file =
    "file:///Applications/Alcyo%20Shorts.app/Contents/Resources/app.asar/out/renderer/index.html";
  it("accepts the bundled page, with any hash route", () => {
    expect(isTrustedSenderUrl(`${file}#/s/abc`, file)).toBe(true);
  });
  it("rejects other files and other origins", () => {
    expect(isTrustedSenderUrl("file:///tmp/evil.html", file)).toBe(false);
    expect(isTrustedSenderUrl("https://example.com/", file)).toBe(false);
    expect(isTrustedSenderUrl("http://localhost:5174/", "http://localhost:5173/")).toBe(false);
    expect(isTrustedSenderUrl("not a url", file)).toBe(false);
  });
  it("ignores drive-letter case on Windows only", () => {
    const win =
      "file:///C:/Users/me/AppData/Local/Programs/Alcyo%20Shorts/resources/app.asar/out/renderer/index.html";
    const lower = win.replace("file:///C:", "file:///c:");
    expect(isTrustedSenderUrl(lower, win, true)).toBe(true);
    expect(isTrustedSenderUrl(lower, win, false)).toBe(false);
  });
  it("accepts the dev server origin", () => {
    expect(isTrustedSenderUrl("http://localhost:5173/#/renders", "http://localhost:5173")).toBe(
      true,
    );
  });
});
