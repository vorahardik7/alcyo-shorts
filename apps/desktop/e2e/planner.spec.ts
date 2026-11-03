// Find shorts and chat edits in the real app, with the scripted test agent
// (ALCYO_TEST_AGENT=script). The stream is seeded on disk with a transcript,
// so no whisper model is needed.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Launched, launch } from "./launch";

const AT = "2026-11-01T12:00:00.000Z";
const streamId = "s_plannere2e";
const sourceId = "src_plannere2e";

/** A stream folder with a 5-minute transcript: 75 lines of 10 words, one every 4 s. */
function seed(userData: string): string {
  const streams = join(userData, "Streams");
  const folder = join(streams, "Boss Fight Stream.alcyo");
  const analysis = join(folder, "sources", sourceId, "analysis");
  mkdirSync(analysis, { recursive: true });
  mkdirSync(join(folder, "thread"), { recursive: true });
  const media = join(userData, "recording.mp4");
  writeFileSync(media, "seeded");
  const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));

  const words: { id: string; text: string; startMs: number; endMs: number; p: number }[] = [];
  const lines: { id: string; startMs: number; endMs: number; wordIds: string[] }[] = [];
  for (let l = 0; l < 75; l++) {
    const ids: string[] = [];
    for (let j = 0; j < 10; j++) {
      const id = `w${String(words.length + 1).padStart(5, "0")}`;
      words.push({ id, text: `word${l}`, startMs: l * 4000 + j * 350, endMs: l * 4000 + j * 350 + 300, p: 0.9 });
      ids.push(id);
    }
    lines.push({ id: `L${String(l + 1).padStart(4, "0")}`, startMs: l * 4000, endMs: l * 4000 + 3450, wordIds: ids });
  }
  json(join(analysis, "transcript.json"), { schemaVersion: 1, sourceId, language: "en", model: "small.en", words, lines });
  json(join(analysis, "silences.json"), {
    schemaVersion: 1,
    sourceId,
    silences: lines.slice(1).map((line, i) => ({ startMs: lines[i]!.endMs, endMs: line.startMs })),
  });
  json(join(folder, "sources", sourceId, "source.json"), {
    schemaVersion: 1,
    sourceId,
    addedAt: AT,
    origin: { kind: "file", path: media, copied: false },
    fingerprint: { sizeBytes: 6, headSha256: "a".repeat(64), tailSha256: "b".repeat(64), durationMs: 300_000, layout: "v+a" },
    probe: {
      durationMs: 300_000,
      container: "mov,mp4",
      video: { codec: "h264", width: 1920, height: 1080, fpsNum: 30, fpsDen: 1 },
      audio: { codec: "aac", sampleRate: 48000, channels: 2 },
      playsDirectly: true,
    },
    info: null,
  });
  json(join(folder, "project.json"), {
    schemaVersion: 1,
    streamId,
    name: "Boss Fight Stream",
    createdAt: AT,
    sources: [{ sourceId }],
    shorts: [],
    clips: [],
    settings: { copyIntoProject: false },
    autoFindAt: AT,
  });
  writeFileSync(join(folder, "thread", "messages.jsonl"), "");
  json(join(userData, "streams.json"), {
    schemaVersion: 1,
    streams: [{ streamId, folder, name: "Boss Fight Stream", thumbnail: null, lastActivityAt: AT, unread: false, preview: "" }],
  });
  return folder;
} // prettier-ignore

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
});
