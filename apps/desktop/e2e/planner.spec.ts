// Find shorts and chat edits in the real app, with the scripted test agent
// (ALCYO_TEST_AGENT=script). The stream is seeded on disk with a transcript,
// so no whisper model is needed.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Launched, launch } from "./launch";
import { seed, streamId } from "./seed";

async function send(page: Page, text: string) {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-input").press("Enter");
}

test.describe("planner", () => {
  let run: Launched;
  let page: Page;
  let userData: string;
  let folder: string;

  test.beforeAll(async () => {
    userData = mkdtempSync(join(tmpdir(), "alcyo-e2e-planner-"));
    folder = seed(userData);
    run = await launch("pass", {
      ALCYO_TEST_AGENT: "script",
      ALCYO_USER_DATA: userData,
      ALCYO_STREAMS_DIR: join(userData, "Streams"),
    });
    page = run.page;
    await page.getByTestId("sidebar").waitFor();
  });

  test.afterAll(async () => {
    await run.close();
    rmSync(userData, { recursive: true, force: true });
  });

  test("Find shorts posts three cards", async () => {
    await page.getByTestId("stream-row").filter({ hasText: "Boss Fight Stream" }).click();
    await page.getByTestId("find-shorts").click();
    const cards = page.getByTestId("shorts-message").getByTestId("short-card");
    await expect(cards).toHaveCount(3, { timeout: 15_000 });
    await expect(cards.first().getByTestId("version-chip")).toHaveText("v1 · Agent");
    await expect(page.getByTestId("working")).toHaveCount(0);
    await expect(page.getByTestId("find-shorts")).toHaveText("Find more shorts");
  });

  test("a card plays inline with the render's crop and captions, one at a time", async () => {
    const cards = page.getByTestId("shorts-message").getByTestId("short-card");
    const player = (n: number) => cards.nth(n).getByTestId("short-player");
    await expect(player(0)).toBeVisible();
    await expect
      .poll(() =>
        cards
          .nth(0)
          .getByTestId("player-video")
          .evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    // 1280 x 720 source: a 404 px window centered in 876 px of room.
    await expect(player(0)).toHaveAttribute("data-crop-x", "438");
    const captions = cards.nth(0).getByTestId("player-captions");
    await expect(captions).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
    // The same .ass the render burns: the hook is drawn at 0.5 s, nothing after every event ends.
    const drawn = (t: number) =>
      captions.evaluate(async (c, at) => {
        const j = (
          c as unknown as {
            jassub: {
              renderer: {
                _drawCapture: (t: number) => Promise<{ data: Uint8ClampedArray } | undefined>;
              };
            };
          }
        ).jassub;
        const out = await j.renderer._drawCapture(at);
        let n = 0;
        for (let i = 3; i < (out?.data.length ?? 0); i += 4) if (out!.data[i]! > 0) n++;
        return n;
      }, t);
    expect(await drawn(0.5)).toBeGreaterThan(1000);
    expect(await drawn(3600)).toBe(0);
    // A draw before JASSUB was ready used to leave it busy for good, drawing nothing.
    await expect
      .poll(() =>
        captions.evaluate((c) => (c as unknown as { jassub: { busy: boolean } }).jassub.busy),
      )
      .toBe(false);

    await cards.nth(0).getByTestId("player-toggle").click();
    await expect(player(0)).toHaveAttribute("data-playing", "true");
    const t0 = await cards
      .nth(0)
      .getByTestId("player-video")
      .evaluate((v: HTMLVideoElement) => v.currentTime);
    await expect
      .poll(() =>
        cards
          .nth(0)
          .getByTestId("player-video")
          .evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(t0 + 0.3);
    await cards.nth(1).getByTestId("player-toggle").click();
    await expect(player(1)).toHaveAttribute("data-playing", "true");
    await expect(player(0)).toHaveAttribute("data-playing", "false");
    await cards.nth(1).getByTestId("player-toggle").click();
    await expect(player(1)).toHaveAttribute("data-playing", "false");
  });

  test("Copy link copies an alcyo:// link, and the version chip is a link", async () => {
    const card = page.getByTestId("shorts-message").getByTestId("short-card").first();
    const shortId = (await card.getAttribute("data-short-id"))!;
    await card.getByTestId("copy-link").click();
    await expect(page.getByText(`alcyo://s/${streamId}/short/${shortId}/v/1`)).toBeVisible();
    await card.getByTestId("version-chip").click();
    await expect
      .poll(() => page.evaluate(() => location.hash))
      .toBe(`#/s/${streamId}/short/${shortId}/v/1`);
    await expect(
      page.locator(`[data-testid="short-card"][data-short-id="${shortId}"][data-focused]`),
    ).toHaveCount(1);
    await page.getByTestId("stream-row").filter({ hasText: "Boss Fight Stream" }).click();
  });

  test("a reply to a card makes a new version of that short", async () => {
    const second = page.getByTestId("shorts-message").getByTestId("short-card").nth(1);
    const shortId = (await second.getAttribute("data-short-id"))!;
    await second.getByTestId("reply-short").click();
    await expect(page.getByTestId("reply-quote")).toContainText("Replying to “Moment 2” v1");
    await send(page, "make it punchier");
    await expect(page.getByTestId("reply-quote")).toHaveCount(0);
    const version = page.getByTestId("version-message");
    await expect(version).toHaveCount(1, { timeout: 15_000 });
    await expect(version).toContainText("Cut the slow start");
    const card = version.getByTestId("short-card");
    await expect(card).toHaveAttribute("data-short-id", shortId);
    await expect(card).toHaveAttribute("data-version", "2");
    await expect(card.getByTestId("short-title")).toHaveText("Straight to it");

    // On disk: version 2 records the message that asked for it.
    const thread = readFileSync(join(folder, "thread", "messages.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(
        (l) =>
          JSON.parse(l) as {
            id: string;
            author: string;
            replyTo?: { shortId: string };
            body: { kind: string; text?: string };
          },
      );
    const asked = thread.find((m) => m.body.text === "make it punchier")!;
    expect(asked.replyTo?.shortId).toBe(shortId);
    const dir = join(folder, "shorts", shortId, "versions");
    expect(readdirSync(dir).sort()).toEqual(["0001.claude.json", "0002.claude.json"]);
    const v2 = JSON.parse(readFileSync(join(dir, "0002.claude.json"), "utf8")) as {
      fromMessageId: string;
    };
    expect(v2.fromMessageId).toBe(asked.id);
  });

  test("a question gets a text answer and changes nothing", async () => {
    await send(page, "why did you pick the first one?");
    await expect(page.getByTestId("agent-text").last()).toContainText("I picked it because", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("version-message")).toHaveCount(1);
  });

  test("Render makes a checked 1080 × 1920 MP4 and records it", async () => {
    test.setTimeout(240_000);
    const card = page.getByTestId("version-message").getByTestId("short-card");
    await card.getByTestId("render-short").click();
    const bubble = page.getByTestId("render-message").last();
    await expect(bubble).toBeVisible();
    await expect(bubble.getByTestId("render-status")).toHaveAttribute("data-state", "done", {
      timeout: 200_000,
    });
    await expect(bubble.getByTestId("render-file")).toContainText("straight-to-it-v2-1080p30.mp4");
    const index = JSON.parse(readFileSync(join(folder, "renders", "index.json"), "utf8")) as {
      renders: {
        file: string;
        version: number;
        probe: { width: number; height: number; videoCodec: string; audioCodec: string };
      }[];
    };
    expect(index.renders).toHaveLength(1);
    expect(index.renders[0]).toMatchObject({
      file: "straight-to-it-v2-1080p30.mp4",
      version: 2,
      probe: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" },
    });
    expect(readdirSync(join(folder, "renders")).sort()).toEqual([
      "index.json",
      "straight-to-it-v2-1080p30.mp4",
    ]);
    // Nothing next to the recording.
    expect(readdirSync(userData).filter((f) => f.startsWith("recording"))).toEqual([
      "recording.mp4",
    ]);
    await page.getByTestId("render-queue-button").click();
    await expect(page.getByTestId("render-item")).toHaveCount(1);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(tmpdir(), "alcyo-render-queue.png") });
    await page.getByTestId("close-drawer").click();
  });

  test("alcyo:// links open a version, the editor page and a message", async () => {
    const card = page.getByTestId("version-message").getByTestId("short-card");
    const shortId = (await card.getAttribute("data-short-id"))!;
    const open = (url: string) =>
      run.app.evaluate(({ app }, u) => {
        app.emit("open-url", { preventDefault: () => undefined }, u);
      }, url);
    await open(`alcyo://s/${streamId}/short/${shortId}/v/2`);
    await expect(
      page.locator(`[data-short-id="${shortId}"][data-version="2"][data-focused]`),
    ).toHaveCount(1);
    await open(`alcyo://s/${streamId}/short/${shortId}/v/2/edit`);
    await expect(page.getByTestId("editor")).toHaveAttribute("data-version", "2");
    await expect(page.getByTestId("editor").getByTestId("short-player")).toBeVisible();
    await open(`alcyo://s/${streamId}/short/${shortId}/v/9`);
    await expect(page.getByTestId("short-not-found")).toContainText("v9");
    const thread = readFileSync(join(folder, "thread", "messages.jsonl"), "utf8")
      .trim()
      .split("\n");
    const first = (JSON.parse(thread[0]!) as { id: string }).id;
    await open(`alcyo://s/${streamId}/m/${first}`);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/s/${streamId}#m-${first}`);
    await expect(page.locator(`#m-${first}`)).toBeInViewport();
  });

  test("older messages load on scroll, keeping the reader's place", async () => {
    await page.getByTestId("stream-row").filter({ hasText: "Long Chat" }).click();
    await expect(page.getByText("Message 249")).toBeVisible();
    await expect(page.getByTestId("message")).toHaveCount(200);
    await expect(page.getByText("Message 49", { exact: true })).toHaveCount(0);
    await page.getByTestId("thread-scroll").evaluate((el) => (el.scrollTop = 0));
    await expect(page.getByTestId("message")).toHaveCount(250);
    await expect(page.getByText("Message 0", { exact: true })).toBeAttached();
    // The message that was at the top is still near the top.
    await expect(page.getByText("Message 50", { exact: true })).toBeInViewport();
  });
});
