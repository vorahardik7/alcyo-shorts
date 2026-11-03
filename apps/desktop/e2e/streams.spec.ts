// Choose a file -> a stream -> analysis, through the real worker and the
// bundled tools. The dialog is stubbed; everything else is real.
//
// With ALCYO_E2E_SOURCE (a recording) and ALCYO_MODELS_DIR (with the whisper
// model) set, one more test runs the whole thing on that recording.
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

/**
 * A VOD whose sound changes over time, and a viewer clip cut from it at a
 * known offset and re-encoded. Served over local http, so the real yt-dlp
 * downloads them and nothing leaves the machine.
 */
function makeVodAndClip(dir: string, clipAtMs: number): void {
  const noise = (seconds: number, out: string, extra: string[] = []) =>
    execFileSync(ffmpeg, [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=30:d=${seconds}`,
      "-f", "lavfi", "-i", `anoisesrc=d=${seconds}:c=pink:seed=11:a=0.5`,
      "-af", "volume='0.15+0.85*abs(sin(t*1.7))*abs(sin(t*0.37+1))':eval=frame",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-shortest", ...extra, out,
    ]); // prettier-ignore
  noise(40, join(dir, "vod.mp4"));
  execFileSync(ffmpeg, [
    "-v", "error", "-y", "-ss", String(clipAtMs / 1000), "-i", join(dir, "vod.mp4"), "-t", "8",
    "-af", "volume=0.7", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "64k",
    join(dir, "clip.mp4"),
  ]); // prettier-ignore
}

/** Serves files from dir with Range support, like a plain web host. */
async function serve(dir: string): Promise<{ url: (name: string) => string; close: () => void }> {
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? "/").slice(1).split("?")[0]!);
    const path = join(dir, name);
    if (name.includes("/") || name.includes("..") || !existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(path).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = range === null ? 0 : Number(range[1]);
    const end = range === null || range[2] === "" ? size - 1 : Number(range[2]);
    res.writeHead(range === null ? 200 : 206, {
      "content-type": "video/mp4",
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
      ...(range === null ? {} : { "content-range": `bytes ${start}-${end}/${size}` }),
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(path, { start, end }).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: (name) => `http://127.0.0.1:${port}/${name}`, close: () => server.close() };
}

async function pasteLink(page: Page, url: string) {
  const input = page.getByTestId("composer-input");
  await input.fill(url);
  await page.keyboard.press("Enter");
}

test.describe("streams from links, and viewer clips", () => {
  let run: Launched;
  let page: Page;
  let host: Awaited<ReturnType<typeof serve>>;
  const clipAtMs = 17_500;

  test.beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "alcyo-e2e-web-"));
    makeVodAndClip(dir, clipAtMs);
    host = await serve(dir);
    run = await launch("pass");
    page = run.page;
    await page.getByTestId("sidebar").waitFor();
  });
  test.afterAll(async () => {
    await run.close();
    host.close();
  });

  test("a link of unknown length asks, then downloads into the project and analyzes", async () => {
    await pasteLink(page, host.url("vod.mp4"));
    await expect.poll(() => hash(page), { timeout: 30_000 }).toMatch(/^#\/s\/s_[0-9a-z]{10}$/);
    await expect(page.getByTestId("thread-header")).toHaveText("vod");
    const question = page.getByTestId("question-message");
    await expect(question).toContainText("Use this as the stream, or add it as a clip?");
    await question.getByTestId("chip-stream").click();
    await expect(question.getByTestId("chip-stream")).toBeDisabled();
    await expect(
      page.getByText("Only download videos you own or have permission to use."),
    ).toBeVisible();
    await waitForStatus(page, "done");
    await expect(page.getByTestId("status-label").last()).toHaveText("Analysis finished", {
      timeout: 90_000,
    });

    const folder = join(run.env["ALCYO_STREAMS_DIR"]!, "vod.alcyo");
    const [sourceId] = readdirSync(join(folder, "sources"));
    const files = readdirSync(join(folder, "sources", sourceId!)).sort();
    expect(files).toEqual(["analysis", "media.info.json", "media.mp4", "source.json"]);
    const source = JSON.parse(
      readFileSync(join(folder, "sources", sourceId!, "source.json"), "utf8"),
    ) as { origin: { kind: string; url: string; path: string }; info: { extractor: string } };
    expect(source.origin).toMatchObject({ kind: "url", url: host.url("vod.mp4") });
    expect(source.origin.path).toBe(join(folder, "sources", sourceId!, "media.mp4"));
    expect(source.info.extractor).toBe("Generic");
  });

  test("a clip link is downloaded, checked, and placed in the stream within 100 ms", async () => {
    await pasteLink(page, host.url("clip.mp4"));
    const clips = page.getByTestId("clips-message");
    await expect(clips).toBeVisible({ timeout: 90_000 });
    await expect(clips.getByTestId("clip-row")).toHaveAttribute("data-placed", "true");
    await expect(clips.getByTestId("clip-placement")).toContainText(
      "In the stream at 0:17 to 0:25",
    );

    const folder = join(run.env["ALCYO_STREAMS_DIR"]!, "vod.alcyo");
    const [clipId] = readdirSync(join(folder, "clips"));
    const clip = JSON.parse(readFileSync(join(folder, "clips", clipId!, "clip.json"), "utf8")) as {
      match: { srcIn: number; method: string; confidence: number };
    };
    expect(clip.match.method).toBe("audio");
    expect(Math.abs(clip.match.srcIn - clipAtMs)).toBeLessThan(100);
    expect(clip.match.confidence).toBeGreaterThanOrEqual(0.6);
  });

  test("a clip file that isn't from this stream can be placed by hand", async () => {
    const other = makeClip(6, "someone else's clip.mp4");
    await stubFileDialog(run.app, other);
    await page.getByTestId("attach").click();
    await page.getByTestId("attach-menu").getByText("Choose a file…").click();
    const row = page.getByTestId("clip-row").filter({ hasText: "someone else's clip" });
    await expect(row).toHaveAttribute("data-placed", "false", { timeout: 60_000 });
    await expect(row).toContainText("Couldn't place this clip");
    await row.getByTestId("place-by-hand").click();
    await row.getByTestId("place-time").fill("0:05");
    await row.getByTestId("place-save").click();
    const placed = page
      .getByTestId("clip-row")
      .filter({ hasText: "someone else's clip" })
      .filter({ hasText: "Placed by hand" });
    await expect(placed.last()).toContainText("In the stream at 0:05 to 0:11");
    expect(readdirSync(join(other, ".."))).toEqual(["someone else's clip.mp4"]);
  });
});
