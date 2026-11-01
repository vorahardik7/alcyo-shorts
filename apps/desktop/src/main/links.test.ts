import { describe, expect, it } from "vitest";
import { findLinkInArgv, LinkQueue, linkEvent } from "./links";

describe("findLinkInArgv (Windows second-instance and first launch)", () => {
  it("finds the link after the exe path and Chromium switches", () => {
    const argv = [
      "C:\\Users\\me\\AppData\\Local\\Programs\\Alcyo Shorts\\Alcyo Shorts.exe",
      "--allow-file-access-from-files",
      "--original-process-start-time=13370000000000000",
      "alcyo://s/abc/short/sh1/v/2",
    ];
    expect(findLinkInArgv(argv)).toBe("alcyo://s/abc/short/sh1/v/2");
  });

  it("matches the scheme in any case", () => {
    expect(findLinkInArgv(["app.exe", "ALCYO://renders/"])).toBe("ALCYO://renders/");
  });

  it("returns undefined without a link", () => {
    expect(findLinkInArgv(["app.exe", "--flag", "C:\\alcyo\\file.txt"])).toBeUndefined();
  });

  it("feeds into a link:open event", () => {
    const url = findLinkInArgv(["app.exe", "alcyo://renders/"]);
    expect(linkEvent(url!)).toEqual({ event: "link:open", payload: { link: { to: "renders" } } });
  });
});

describe("linkEvent", () => {
  it("opens a valid link", () => {
    expect(linkEvent("alcyo://s/abc")).toEqual({
      event: "link:open",
      payload: { link: { to: "stream", streamId: "abc" } },
    });
  });

  it("reports a malformed link with the plain message", () => {
    expect(linkEvent("alcyo://s/abc/nope")).toEqual({
      event: "link:invalid",
      payload: { message: "That link doesn't point to anything in this app." },
    });
  });
});

describe("LinkQueue", () => {
  it("holds links until attached, then delivers in order", () => {
    const queue = new LinkQueue();
    const got: string[] = [];
    queue.push("a");
    queue.push("b");
    queue.attach((u) => got.push(u));
    queue.push("c");
    expect(got).toEqual(["a", "b", "c"]);
  });

  it("queues again after detach", () => {
    const queue = new LinkQueue();
    const got: string[] = [];
    queue.attach((u) => got.push(u));
    queue.detach();
    queue.push("x");
    expect(got).toEqual([]);
    queue.attach((u) => got.push(u));
    expect(got).toEqual(["x"]);
  });
});
