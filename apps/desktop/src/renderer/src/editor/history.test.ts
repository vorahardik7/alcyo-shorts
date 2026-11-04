import { describe, expect, it } from "vitest";
import { push, redo, saveNote, start, undo } from "./history";

describe("editor history", () => {
  it("undoes and redoes at least 200 steps", () => {
    let h = start(0);
    for (let i = 1; i <= 250; i++) h = push(h, i, `step ${i}`);
    for (let i = 0; i < 250; i++) h = undo(h);
    expect(h.present.value).toBe(0);
    expect(undo(h)).toBe(h);
    for (let i = 0; i < 250; i++) h = redo(h);
    expect(h.present).toEqual({ value: 250, label: "step 250" });
    expect(redo(h)).toBe(h);
  });

  it("a new edit drops redo steps; the same value adds nothing", () => {
    let h = push(push(start("a"), "b", "B"), "c", "C");
    h = undo(h);
    expect(h.future.map((s) => s.value)).toEqual(["c"]);
    h = push(h, "d", "D");
    expect(h.future).toEqual([]);
    expect(push(h, h.present.value, "same")).toBe(h);
  });

  it("keeps the newest steps past the limit", () => {
    let h = start(0);
    for (let i = 1; i <= 20; i++) h = push(h, i, "", 10);
    expect(h.past).toHaveLength(10);
    expect(h.past[0]!.value).toBe(10);
  });

  it("writes the version note from the steps since the last save", () => {
    let h = start(0);
    h = push(h, 1, "Cut 2 words");
    const savedAt = h.past.length;
    expect(saveNote(h, savedAt)).toBe("Edited in the editor");
    h = push(h, 2, "New hook");
    h = push(h, 3, "Split");
    h = push(h, 4, "Split");
    expect(saveNote(h, savedAt)).toBe("New hook, Split");
  });
});
