// The editor (spec 11) in the real app with the scripted agent, on the seeded
// 5-minute stream: transcript cuts and restores, split, trims, captions,
// reframe, hook, 200+ undo steps, shortcuts, saving a version, the chat
// drawer, and a JASSUB frame against an ffmpeg frame of the same .ass.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type Launched, launch, showInvisibly } from "./launch";
import { ffmpeg, seed, streamId } from "./seed";

const mod = process.platform === "darwin" ? "Meta" : "Control";
const fonts = join(import.meta.dirname, "..", "resources", "fonts");

let run: Launched;
let page: Page;
let userData: string;
let folder: string;
let shortId: string;

const segs = () => page.getByTestId("timeline").getByTestId("segment");
const timeText = () => page.getByTestId("editor-time").innerText();
const durMs = async () => {
  const total = (await timeText()).split(" / ")[1]!;
  const [m, s] = total.split(":").map(Number);
  return (m! * 60 + s!) * 1000;
};
const kept = (w: Locator) => w.getAttribute("data-kept");
/** Clicks the ruler at the very start: playhead to 0, focus off any text box. */
async function toStart() {
  const r = (await page.getByTestId("ruler").boundingBox())!;
  await page.mouse.click(r.x + 2, r.y + r.height / 2);
  await expect.poll(timeText).toMatch(/^0:00 /);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), "alcyo-e2e-editor-"));
  folder = seed(userData);
  run = await launch("pass", {
    ALCYO_TEST_AGENT: "script",
    ALCYO_USER_DATA: userData,
    ALCYO_STREAMS_DIR: join(userData, "Streams"),
  });
  page = run.page;
  await showInvisibly(run.app);
  await page.getByTestId("stream-row").filter({ hasText: "Boss Fight Stream" }).click();
  await page.getByTestId("find-shorts").click();
  const cards = page.getByTestId("shorts-message").getByTestId("short-card");
  // Every card, so first() is short 1 and not whichever preview loaded first.
  await expect(cards).toHaveCount(3, { timeout: 15_000 });
  const card = cards.first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  shortId = (await card.getAttribute("data-short-id"))!;
  await card.getByTestId("open-editor").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("player-captions")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });
});

test.afterAll(async () => {
  await run.close();
  rmSync(userData, { recursive: true, force: true });
});

test("opens with the preview, transcript, timeline and chat", async () => {
  if (process.env["ALCYO_SHOT"] !== undefined) {
    await page.waitForTimeout(800);
    const png = await run.app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
        .toPNG()
        .toString("base64"),
    );
    writeFileSync(process.env["ALCYO_SHOT"], Buffer.from(png, "base64"));
  }
  await expect(page.getByTestId("editor")).toHaveAttribute("data-version", "1");
  await expect(page.getByTestId("editor-origin")).toContainText("Agent v1");
  await expect(page.getByTestId("word").first()).toBeVisible();
  await expect(segs()).toHaveCount(1);
  await expect(page.getByTestId("chat-drawer")).toBeVisible();
  await expect(page.getByTestId("safe-areas")).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcut-help")).toContainText("Split at the playhead");
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcut-help")).toHaveCount(0);
});

test("deleting words ripple-cuts them; they stay visible and come back", async () => {
  const before = await durMs();
  const words = page.locator('[data-testid="word"][data-kept="true"]');
  const a = words.nth(12);
  const b = words.nth(15);
  const ida = (await a.getAttribute("data-word"))!;
  const idb = (await b.getAttribute("data-word"))!;
  await a.click();
  await b.click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");
  const wa = page.locator(`[data-word="${ida}"]`);
  const wb = page.locator(`[data-word="${idb}"]`);
  await expect(wa).toHaveAttribute("data-kept", "false");
  expect(await kept(wb)).toBe("false");
  await expect(segs()).toHaveCount(2);
  expect(await durMs()).toBeLessThan(before);
  // Select the cut words and press Delete again: back.
  await wa.click();
  await wb.click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");
  await expect(wa).toHaveAttribute("data-kept", "true");
  await expect(segs()).toHaveCount(1);
  // Undo twice: back to the start, and redo once: cut again.
  await page.keyboard.press(`${mod}+z`);
  await expect(wa).toHaveAttribute("data-kept", "false");
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(wa).toHaveAttribute("data-kept", "false");
  await page.keyboard.press(`${mod}+z`);
  await expect(segs()).toHaveCount(1);
});

test("split at the playhead, select with I and O, and ripple-delete", async () => {
  await toStart();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(timeText).toMatch(/^0:05 /);
  await page.keyboard.press("s");
  await expect(segs()).toHaveCount(2);
  const before = await durMs();
  await page.keyboard.press("i");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("o");
  await expect(page.getByTestId("selection")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect.poll(durMs).toBe(before - 3000);
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+z`);
  await expect(segs()).toHaveCount(1);
});

test("dragging a segment edge trims it, snapping to a word", async () => {
  const seg = segs().first();
  const out0 = Number(await seg.getAttribute("data-src-out"));
  const handle = seg.getByTestId("trim-out");
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const out1 = Number(await seg.getAttribute("data-src-out"));
  expect(out1).toBeLessThan(out0);
  // Seeded words end at 300 or 650 ms past each 350 ms step; a snapped edge lands on one.
  const view = await page.evaluate(
    ([s, id]) => window.alcyo.invoke("editor:open", { streamId: s, shortId: id }),
    [streamId, shortId] as const,
  );
  const edges = new Set(view.words.flatMap((w) => [w.startMs, w.endMs]));
  for (const s of view.silences) {
    edges.add(s.startMs);
    edges.add(s.endMs);
  }
  expect(edges.has(out1)).toBe(true);
  await page.keyboard.press(`${mod}+z`);
  expect(Number(await seg.getAttribute("data-src-out"))).toBe(out0);
});

test("captions: text, hide, nudge and words per line are overrides", async () => {
  const word = page.locator('[data-testid="word"][data-kept="true"]').nth(2);
  const id = (await word.getAttribute("data-word"))!;
  await word.click();
  await page.getByTestId("panel-captions").click();
  await expect(page.getByTestId("word-editor")).toHaveAttribute("data-word", id);
  await page.getByTestId("word-text").fill("NO WAY");
  await page.getByTestId("word-text-save").click();
  await page.getByTestId("nudge-100").click();
  await page.getByTestId("nudge--10").click();
  await page.getByTestId("word-hide").click();
  await page.getByTestId("word-hide").click();
  await page.getByTestId("wpl-2").click();
  await expect(page.getByTestId("word-text")).toHaveValue("NO WAY");
});

test("reframe: drag the window and add keyframes", async () => {
  await page.getByTestId("panel-reframe").click();
  await expect(page.getByTestId("crop-key")).toHaveCount(1);
  // The drag sets the key at the playhead: the existing one at 0.
  await toStart();
  const frame = (await page.getByTestId("reframe-frame").boundingBox())!;
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + 2, frame.y + frame.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("reframe-window")).toHaveAttribute("data-x", "0.000");
  await expect.poll(() => page.getByTestId("short-player").getAttribute("data-crop-x")).toBe("0");
  await page.getByTestId("ease-linear").click();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.getByTestId("add-key").click();
  await expect(page.getByTestId("crop-key")).toHaveCount(2);
  await expect(page.getByTestId("key-diamond")).toHaveCount(2);
});

test("hook: text, start and end, and the safe areas toggle", async () => {
  await page.getByTestId("panel-hook").click();
  await page.getByTestId("hook-text").fill("He did it AGAIN");
  await page.getByTestId("hook-text-save").click();
  await expect(page.getByTestId("hook-bar")).toContainText("He did it AGAIN");
  await page.getByTestId("hook-end").click();
  await page.getByTestId("toggle-guides").uncheck();
  await expect(page.getByTestId("safe-areas")).toHaveCount(0);
  await page.getByTestId("toggle-guides").check();
});

test("at least 200 steps undo", async () => {
  await page.getByTestId("panel-captions").click();
  const word = page.locator('[data-testid="word-editor"]');
  await expect(word).toBeVisible();
  const delta = async () => {
    const view = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="word-editor"]');
      return el?.getAttribute("data-word") ?? "";
    });
    return view;
  };
  expect(await delta()).not.toBe("");
  for (let i = 0; i < 205; i++) await page.getByTestId("nudge-10").click();
  await expect(page.getByText(/Shown 1000 ms late/)).toBeVisible();
  for (let i = 0; i < 205; i++) await page.keyboard.press(`${mod}+z`);
  // Back to before the nudges: +100, −10 from the captions test.
  await expect(page.getByText("Shown 90 ms late.")).toBeVisible();
});

test("Save makes a user version and a version message", async () => {
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByTestId("editor")).toHaveAttribute("data-version", "2");
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .toContain(`/short/${shortId}/v/2/edit`);
  const dir = join(folder, "shorts", shortId, "versions");
  expect(readdirSync(dir).sort()).toEqual(["0001.claude.json", "0002.user.json"]);
  const v2 = JSON.parse(readFileSync(join(dir, "0002.user.json"), "utf8")) as {
    parent: number;
    note: string;
    short: {
      captions: { wordsPerLine: number; overrides: { text?: string; startDelta?: number }[] };
      crop: { keys: { x: number }[] };
      hook: { text: string };
    };
  };
  expect(v2.parent).toBe(1);
  expect(v2.short.captions.wordsPerLine).toBe(2);
  expect(v2.short.captions.overrides).toEqual([
    expect.objectContaining({ text: "NO WAY", startDelta: 90, endDelta: 90 }),
  ]);
  expect(v2.short.crop.keys).toHaveLength(2);
  expect(v2.short.crop.keys[0]!.x).toBe(0);
  expect(v2.short.hook.text).toBe("He did it AGAIN");
  expect(v2.note.length).toBeGreaterThan(0);
  const thread = readFileSync(join(folder, "thread", "messages.jsonl"), "utf8")
    .trim()
    .split("\n");
  const last = JSON.parse(thread.at(-1)!) as {
    author: string;
    body: { kind: string; ref: { version: number } };
  };
  expect(last).toMatchObject({ author: "user", body: { kind: "version", ref: { version: 2 } } });
  await expect(page.getByTestId("save-version")).toBeDisabled();
});

test("a message from the chat drawer targets this short; its version loads as an undoable step", async () => {
  await page.keyboard.press(`${mod}+k`);
  await expect(page.getByTestId("drawer-input")).toBeFocused();
  await page.keyboard.type("make it punchier");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("incoming")).toContainText("v3", { timeout: 15_000 });
  await page.getByTestId("take-incoming").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-version", "3");
  await expect(page.getByTestId("editor-origin")).toContainText("make it punchier");
  await toStart();
  await page.keyboard.press(`${mod}+z`);
  await expect(page.getByTestId("save-version")).toBeEnabled();
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(page.getByTestId("save-version")).toBeDisabled();
});

test("an older version opens, and Restore makes it the latest", async () => {
  await page.getByTestId("versions").selectOption("1");
  await expect(page.getByTestId("editor")).toHaveAttribute("data-version", "1");
  await page.getByTestId("restore-version").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-version", "4");
  await expect(page.getByTestId("restore-version")).toHaveCount(0);
});

test("a JASSUB frame matches an ffmpeg frame of the same caption", async () => {
  const canvas = page.getByTestId("player-captions");
  // The same .ass the render burns, from main.
  const preview = await page.evaluate(
    ([s, id]) => window.alcyo.invoke("short:preview", { streamId: s, shortId: id }),
    [streamId, shortId] as const,
  );
  const tSec = 0.5;
  const G = { w: 54, h: 96 };
  // JASSUB: which grid cells have any caption pixel.
  const jassub = await canvas.evaluate(
    async (c, [t, gw, gh]) => {
      const j = (
        c as unknown as {
          jassub: {
            renderer: {
              _drawCapture: (
                t: number,
              ) => Promise<{ data: Uint8ClampedArray; width: number; height: number } | undefined>;
            };
          };
        }
      ).jassub;
      const out = (await j.renderer._drawCapture(t))!;
      const cells = new Array<number>(gw * gh).fill(0);
      for (let y = 0; y < out.height; y++) {
        for (let x = 0; x < out.width; x++) {
          if (out.data[(y * out.width + x) * 4 + 3]! > 60) {
            cells[Math.floor((y / out.height) * gh) * gw + Math.floor((x / out.width) * gw)] = 1;
          }
        }
      }
      return cells;
    },
    [tSec, G.w, G.h] as const,
  );
  // ffmpeg: the same .ass on mid-gray, with the bundled fonts; cells that differ from gray.
  const dir = mkdtempSync(join(tmpdir(), "alcyo-ass-"));
  writeFileSync(join(dir, "c.ass"), preview.ass);
  // Relative names inside the work folder, as the render engine passes them, so no
  // drive letter (D:) has to be escaped inside the filter graph.
  cpSync(fonts, join(dir, "fonts"), { recursive: true });
  const raw = execFileSync(
    ffmpeg,
    [
      "-v", "error", "-f", "lavfi", "-i", "color=c=0x808080:s=1080x1920:r=30:d=1",
      "-vf", "subtitles=filename=c.ass:fontsdir=fonts,format=gray",
      "-ss", String(tSec), "-frames:v", "1", "-f", "rawvideo", "-",
    ],
    { cwd: dir, maxBuffer: 8 * 1024 * 1024 },
  ); // prettier-ignore
  rmSync(dir, { recursive: true, force: true });
  const ff = new Array<number>(G.w * G.h).fill(0);
  for (let y = 0; y < 1920; y++) {
    for (let x = 0; x < 1080; x++) {
      if (Math.abs(raw[y * 1080 + x]! - 128) > 40) {
        ff[Math.floor((y / 1920) * G.h) * G.w + Math.floor((x / 1080) * G.w)] = 1;
      }
    }
  }
  let both = 0;
  let either = 0;
  for (let i = 0; i < ff.length; i++) {
    if (ff[i] === 1 && jassub[i] === 1) both++;
    if (ff[i] === 1 || jassub[i] === 1) either++;
  }
  expect(either).toBeGreaterThan(20);
  // The same caption and hook cover the same cells.
  console.log(
    `JASSUB vs ffmpeg caption cells: ${both} shared of ${either} (${Math.round((both / either) * 100)}%)`,
  );
  expect(both / either).toBeGreaterThan(0.8);
});
