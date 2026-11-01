import { describe, expect, it } from "vitest";
import { forbiddenPaths } from "../check-no-media.mjs";
import { isForbiddenMedia, isMediaPath } from "../media-extensions.mjs";

describe("media paths", () => {
  it("recognises video and audio, not TypeScript", () => {
    expect(isMediaPath("a/b.MP4")).toBe(true);
    expect(isMediaPath("voice.opus")).toBe(true);
    expect(isMediaPath("*.mkv")).toBe(true);
    expect(isMediaPath("src/index.ts")).toBe(false);
    expect(isMediaPath("src/types.mts")).toBe(false);
    expect(isMediaPath("mp4.json")).toBe(false);
  });

  it("allows media only under examples/demo/", () => {
    expect(isForbiddenMedia("examples/demo/clip.mp4")).toBe(false);
    expect(isForbiddenMedia("examples/demo/clips/a.mp4")).toBe(false);
    expect(isForbiddenMedia("./examples/demo/clip.mp4")).toBe(false);
    expect(isForbiddenMedia("examples/demo.alcyo/renders/x.mp4")).toBe(true);
    expect(isForbiddenMedia("renders\\x.wav")).toBe(true);
  });
});

describe("forbiddenPaths", () => {
  it("lists tracked media outside examples/demo/", () => {
    expect(
      forbiddenPaths(["README.md", "examples/demo/clip.mp4", "assets/intro.mov", "", "x.ts"]),
    ).toEqual(["assets/intro.mov"]);
  });
});
