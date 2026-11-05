// The judge path (plan section 30): no agent signed in, no key, no model.
// Skip setup, open the demo stream, render short 1 and check the file with
// ffprobe. A chat message says plainly that no agent is signed in.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Launched, launch } from "./launch";
import { bin } from "./seed";

const ffprobe = join(bin, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const NO_AGENT =
  "No coding agent is signed in. Open Setup to sign in to Claude Code, Grok or Codex, or save an API key in Settings.";

test.describe("demo stream", () => {
  let run: Launched;
  let page: Page;
  let streams: string;

  test.beforeAll(async () => {
    streams = mkdtempSync(join(tmpdir(), "alcyo-e2e-demo-"));
    run = await launch("fail", { ALCYO_STREAMS_DIR: streams });
    page = run.page;
    await page.getByTestId("setup").waitFor();
  });

  test.afterAll(async () => {
    await run.close();
    rmSync(streams, { recursive: true, force: true });
  });

  test("opens with no agent: three cards, a chat revision, an editor version, placed clips", async () => {
    await page.getByTestId("skip-setup").click();
    await page.getByTestId("open-demo").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/s/s_demostream");
    // Cards load when they scroll into view; the thread opens at the bottom.
    await page.getByTestId("shorts-message").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("shorts-message").getByTestId("short-card")).toHaveCount(3);
    await expect(page.getByText("make the first one punchier", { exact: false })).toBeVisible();
    await expect(page.getByTestId("version-message")).toHaveCount(2);
    await expect(
      page.getByTestId("version-message").getByTestId("version-chip").filter({ hasText: "You" }),
    ).not.toHaveCount(0);
    const rows = page.getByTestId("clips-message").getByTestId("clip-row");
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) await expect(row).toHaveAttribute("data-placed", "true");
    await expect(page.getByTestId("stream-row").filter({ hasText: "Demo Stream" })).toHaveCount(1);
    // The recording and clips were copied into the project, not referenced.
    const folder = join(streams, "Demo Stream.alcyo");
    const sources = readdirSync(join(folder, "sources"));
    expect(existsSync(join(folder, "sources", sources[0]!, "media.mp4"))).toBe(true);
  });

  test("short 1 renders to a checked 1080 × 1920 MP4", async () => {
    test.setTimeout(240_000);
    await page.getByTestId("shorts-message").scrollIntoViewIfNeeded();
    const cards = page.getByTestId("shorts-message").getByTestId("short-card");
    // Every card, so first() is short 1 and not whichever preview loaded first.
    await expect(cards).toHaveCount(3, { timeout: 15_000 });
    await cards.first().getByTestId("render-short").click();
    const bubble = page.getByTestId("render-message").last();
    await expect(bubble.getByTestId("render-status")).toHaveAttribute("data-state", "done", {
      timeout: 200_000,
    });
    const renders = join(streams, "Demo Stream.alcyo", "renders");
    const file = readdirSync(renders).find((f) => f.endsWith(".mp4"));
    expect(file).toBeDefined();
    const probe = JSON.parse(
      execFileSync(ffprobe, [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,width,height:format=duration",
        "-of",
        "json",
        join(renders, file!),
      ]).toString(),
    ) as {
      streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
      format: { duration: string };
    };
    const video = probe.streams.find((s) => s.codec_type === "video");
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    expect(video).toMatchObject({ codec_name: "h264", width: 1080, height: 1920 });
    expect(audio).toMatchObject({ codec_name: "aac" });
    // Within 100 ms of the kept segments of the card's version (v1).
    const folder = join(streams, "Demo Stream.alcyo");
    const project = JSON.parse(readFileSync(join(folder, "project.json"), "utf8")) as {
      shorts: { shortId: string }[];
    };
    const v1 = JSON.parse(
      readFileSync(
        join(folder, "shorts", project.shorts[0]!.shortId, "versions", "0001.claude.json"),
        "utf8",
      ),
    ) as { short: { segments: { srcIn: number; srcOut: number }[] } };
    const keptMs = v1.short.segments.reduce((n, s) => n + s.srcOut - s.srcIn, 0);
    expect(Math.abs(Number(probe.format.duration) * 1000 - keptMs)).toBeLessThan(100);
  });

  test("a chat message says no agent is signed in", async () => {
    await page.getByTestId("composer-input").fill("find one more short");
    await page.getByTestId("composer-input").press("Enter");
    await expect(page.getByTestId("thread-scroll").getByText(NO_AGENT)).toBeVisible({
      timeout: 15_000,
    });
  });
});
