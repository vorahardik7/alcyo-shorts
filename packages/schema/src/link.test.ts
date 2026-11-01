import { describe, expect, it } from "vitest";
import { type AppLink, appLinkToRoute, formatAppLink, parseAppLink } from "./link";

const cases: Array<[string, AppLink, string]> = [
  ["alcyo://s/abc", { to: "stream", streamId: "abc" }, "/s/abc"],
  ["alcyo://s/abc/m/m1", { to: "message", streamId: "abc", messageId: "m1" }, "/s/abc#m-m1"],
  ["alcyo://s/abc/short/sh1", { to: "short", streamId: "abc", shortId: "sh1" }, "/s/abc/short/sh1"],
  [
    "alcyo://s/abc/short/sh1/v/3",
    { to: "short", streamId: "abc", shortId: "sh1", version: 3 },
    "/s/abc/short/sh1/v/3",
  ],
  [
    "alcyo://s/abc/short/sh1/v/3/edit",
    { to: "short", streamId: "abc", shortId: "sh1", version: 3, edit: true },
    "/s/abc/short/sh1/v/3/edit",
  ],
  ["alcyo://s/abc/source", { to: "source", streamId: "abc" }, "/s/abc/source"],
  [
    "alcyo://s/abc/source?t=83000",
    { to: "source", streamId: "abc", t: 83000 },
    "/s/abc/source?t=83000",
  ],
  ["alcyo://renders", { to: "renders" }, "/renders"],
  ["alcyo://settings", { to: "settings" }, "/settings"],
  ["alcyo://settings/profile", { to: "profile" }, "/settings/profile"],
];

describe("parseAppLink", () => {
  it.each(cases)("parses %s", (url, link) => {
    expect(parseAppLink(url)).toEqual(link);
  });

  it.each(cases)("formats back to %s", (url, link) => {
    expect(formatAppLink(link)).toBe(url);
  });

  it.each(cases)("routes %s", (_url, link, route) => {
    expect(appLinkToRoute(link)).toBe(route);
  });

  it("ignores one trailing slash and scheme case (Windows argv)", () => {
    expect(parseAppLink("alcyo://renders/")).toEqual({ to: "renders" });
    expect(parseAppLink("ALCYO://s/abc/")).toEqual({ to: "stream", streamId: "abc" });
  });

  it("decodes and re-encodes ids", () => {
    const link = parseAppLink("alcyo://s/My%20Stream");
    expect(link).toEqual({ to: "stream", streamId: "My Stream" });
    expect(formatAppLink(link!)).toBe("alcyo://s/My%20Stream");
  });

  it.each([
    "",
    "alcyo://",
    "alcyo:///",
    "https://s/abc",
    "alcyo:s/abc",
    "alcyo://s",
    "alcyo://s//m/x",
    "alcyo://s/abc/unknown",
    "alcyo://s/abc/m",
    "alcyo://s/abc/m/a/b",
    "alcyo://s/abc/short",
    "alcyo://s/abc/short/x/v",
    "alcyo://s/abc/short/x/v/0",
    "alcyo://s/abc/short/x/v/1.5",
    "alcyo://s/abc/short/x/v/-1",
    "alcyo://s/abc/short/x/v/2/edit/more",
    "alcyo://s/abc/short/x/v/2/view",
    "alcyo://s/abc/source?t=-5",
    "alcyo://s/abc/source?t=1.5",
    "alcyo://s/%E0%A4%A",
    "alcyo://settings/other",
    "alcyo://renders/x",
    `alcyo://s/${"a".repeat(3000)}`,
  ])("rejects %s", (url) => {
    expect(parseAppLink(url)).toBeNull();
  });
});
