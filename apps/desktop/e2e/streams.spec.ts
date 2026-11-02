// Choose a file -> a stream -> analysis, through the real worker and the
// bundled tools. The dialog is stubbed; everything else is real.
//
// With ALCYO_E2E_SOURCE (a recording) and ALCYO_MODELS_DIR (with the whisper
// model) set, one more test runs the whole thing on that recording.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Launched, launch, stubFileDialog } from "./launch";

const win = process.platform === "win32";
const target = `${win ? "win" : "mac"}-${process.arch}`;
const bin =
  process.env["ALCYO_BIN_DIR"] ?? join(import.meta.dirname, "..", "resources", "bin", target);
const ffmpeg = join(bin, win ? "ffmpeg.exe" : "ffmpeg");

/** A clip in a folder with spaces and non-ASCII, like a real Videos folder. */
function makeClip(seconds: number, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "alcyo-e2e-src-"));
  const folder = join(dir, "Stream recordings 名前");
  mkdirSync(folder);
  const out = join(folder, name);
  execFileSync(ffmpeg, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:d=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    out,
  ]); // prettier-ignore
  return out;
}

const hash = (page: Page) => page.evaluate(() => window.location.hash);

async function waitForStatus(page: Page, state: string, timeout = 90_000) {
  await expect(page.getByTestId("status-message").last()).toHaveAttribute("data-state", state, {
    timeout,
  });
}

test.describe("streams from a chosen file", () => {
  let run: Launched;
  let page: Page;

  test.beforeAll(async () => {
    run = await launch("pass");
    page = run.page;
    await page.getByTestId("sidebar").waitFor();
  });
  test.afterAll(async () => run.close());

  test("Choose a file makes a stream, analyzes it, and shows it in the sidebar", async () => {
    const clip = makeClip(8, "Soul's stream (part 1).mp4");
    await stubFileDialog(run.app, clip);
    await page.getByTestId("choose-file").click();

    await expect.poll(() => hash(page)).toMatch(/^#\/s\/s_[0-9a-z]{10}$/);
    await expect(page.getByTestId("thread-header")).toHaveText("Soul's stream (part 1)");
    await expect(page.getByTestId("message").first()).toContainText(
      "Added Soul's stream (part 1).mp4. It stays where it is",
    );
    await waitForStatus(page, "done");
    await expect(page.getByTestId("status-label").last()).toHaveText("Analysis finished");
    // The test profile has no whisper model.
    await expect(page.getByTestId("message").last()).toContainText(
      "The transcription model isn't downloaded yet. Open Setup to get it.",
    );

    const row = page.getByTestId("stream-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Soul's stream (part 1)");
    await expect(row).toContainText("Analysis finished");
    // Viewing the stream marks it read.
    await expect(page.getByTestId("unread-dot")).toHaveCount(0);

    // The stream folder is in the streams folder; nothing went next to the clip.
    const streamsDir = run.env["ALCYO_STREAMS_DIR"]!;
    expect(readdirSync(streamsDir)).toEqual(["Soul's stream (part 1).alcyo"]);
    expect(readdirSync(join(clip, ".."))).toEqual(["Soul's stream (part 1).mp4"]);
    const folder = join(streamsDir, "Soul's stream (part 1).alcyo");
    const [sourceId] = readdirSync(join(folder, "sources"));
    const analysis = readdirSync(join(folder, "sources", sourceId!, "analysis")).sort();
    expect(analysis).toEqual([
      "loudness.json",
      "probe.json",
      "scenes.json",
      "silences.json",
      "steps.json",
    ]);
    const source = JSON.parse(
      readFileSync(join(folder, "sources", sourceId!, "source.json"), "utf8"),
    ) as {
      probe: { durationMs: number } | null;
      origin: { path: string };
    };
    expect(source.origin.path).toBe(clip);
    expect(Math.abs(source.probe!.durationMs - 8000)).toBeLessThan(100);
  });

  test("Cancel stops a running analysis", async () => {
    const clip = makeClip(240, "long stream.mp4");
    await stubFileDialog(run.app, clip);
    await page.getByTestId("new-stream").click();
    await page.getByTestId("choose-file").click();
    await expect(page.getByTestId("thread-header")).toHaveText("long stream");
    await page.getByTestId("cancel-job").click();
    await waitForStatus(page, "cancelled", 20_000);
    await expect(page.getByTestId("status-label").last()).toHaveText("Analysis cancelled");
    await expect(page.getByTestId("stream-row")).toHaveCount(2);
  });

  test("Back from a stream returns home, and the sidebar opens it again", async () => {
    await page.getByTestId("stream-row").filter({ hasText: "Soul's stream" }).click();
    await expect(page.getByTestId("thread-header")).toHaveText("Soul's stream (part 1)");
    await expect(page.getByTestId("status-label").last()).toHaveText("Analysis finished");
    await page.getByTestId("settings-row").click();
    await page.getByTestId("section-storage").click();
    await expect(page.getByTestId("streams-folder")).toHaveText(run.env["ALCYO_STREAMS_DIR"]!);
    await page.getByTestId("back").click();
    await expect(page.getByTestId("thread-header")).toHaveText("Soul's stream (part 1)");
  });
});

const realSource = process.env["ALCYO_E2E_SOURCE"];
const realModels = process.env["ALCYO_MODELS_DIR"];

test.describe("a real recording", () => {
  test.skip(
    realSource === undefined || realModels === undefined || !existsSync(realSource),
    "Set ALCYO_E2E_SOURCE and ALCYO_MODELS_DIR to run it.",
  );

  test("analyzes it end to end with the real whisper model", async () => {
    test.setTimeout(600_000);
    const run = await launch("real", { ALCYO_MODELS_DIR: realModels! });
    try {
      const page = run.page;
      await page
        .locator('[data-testid="sidebar"], [data-testid="setup"]')
        .first()
        .waitFor({ timeout: 60_000 });
      await page.evaluate(() => {
        window.location.hash = "#/";
      });
      await stubFileDialog(run.app, realSource!);
      await page.getByTestId("choose-file").click();
      await waitForStatus(page, "done", 540_000);
      await expect(page.getByTestId("status-label").last()).toHaveText("Analysis finished");
      await expect(page.getByText("The transcription model isn't downloaded yet.")).toHaveCount(0);

      const streamsDir = run.env["ALCYO_STREAMS_DIR"]!;
      const [folderName] = readdirSync(streamsDir);
      const folder = join(streamsDir, folderName!);
      const [sourceId] = readdirSync(join(folder, "sources"));
      const transcript = JSON.parse(
        readFileSync(join(folder, "sources", sourceId!, "analysis", "transcript.json"), "utf8"),
      ) as { words: unknown[]; lines: unknown[] };
      console.log(`[real] ${transcript.words.length} words, ${transcript.lines.length} lines`);
      expect(transcript.words.length).toBeGreaterThan(100);
      await page.screenshot({
        path: join(
          import.meta.dirname,
          "..",
          "..",
          "..",
          ".agent-runs",
          "screens",
          "spec4",
          "real-thread.png",
        ),
      });
    } finally {
      await run.close();
    }
  });
});
