import { describe, expect, it } from "vitest";
import { savedPath, target } from "../hooks/lint-file.mjs";

describe("savedPath", () => {
  it("reads Kiro's file_path field", () => {
    expect(
      savedPath({ hook_event_name: "PostFileSave", cwd: "/r", file_path: "/r/src/a.ts" }),
    ).toBe("/r/src/a.ts");
  });

  it("falls back to other field names", () => {
    expect(savedPath({ filePath: "a.ts" })).toBe("a.ts");
    expect(savedPath({ tool_input: { path: "b.ts" } })).toBe("b.ts");
    expect(savedPath({ paths: ["c.ts"] })).toBe("c.ts");
    expect(savedPath({})).toBeUndefined();
  });
});

describe("target", () => {
  it("accepts a .ts file inside the repo", () => {
    expect(target("/r/src/a.ts", "/r", "/r")).toEqual({ file: "/r/src/a.ts" });
    expect(target("src/b.tsx", "/r", "/r")).toEqual({ file: "/r/src/b.tsx" });
  });

  it("skips anything else", () => {
    expect(target(undefined, "/r", "/r")).toHaveProperty("skip");
    expect(target("/elsewhere/a.ts", "/r", "/r")).toHaveProperty("skip");
    expect(target("/r/README.md", "/r", "/r")).toHaveProperty("skip");
    expect(target("/r/node_modules/x/a.ts", "/r", "/r")).toHaveProperty("skip");
    expect(target("/r/apps/desktop/out/main/index.ts", "/r", "/r")).toHaveProperty("skip");
  });
});
