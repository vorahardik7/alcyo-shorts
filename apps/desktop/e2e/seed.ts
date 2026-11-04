// A seeded stream for the planner and editor e2e tests: a real 5-minute
// recording (made with the bundled ffmpeg), a transcript of 75 lines, and a
// second stream with a long chat. No whisper model is needed.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const bin =
  process.env["ALCYO_BIN_DIR"] ??
  join(
    import.meta.dirname,
    "..",
    "resources",
    "bin",
    `${process.platform === "win32" ? "win" : "mac"}-${process.arch}`,
  );
export const ffmpeg = join(bin, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

export const AT = "2026-11-01T12:00:00.000Z";
export const streamId = "s_plannere2e";
export const sourceId = "src_plannere2e";

/** A stream folder with a 5-minute transcript: 75 lines of 10 words, one every 4 s. */
export function seed(userData: string): string {
  const streams = join(userData, "Streams");
  const folder = join(streams, "Boss Fight Stream.alcyo");
  const analysis = join(folder, "sources", sourceId, "analysis");
  mkdirSync(analysis, { recursive: true });
  mkdirSync(join(folder, "thread"), { recursive: true });
  // A real 5-minute recording, so Render runs the bundled ffmpeg for real.
  const media = join(userData, "recording.mp4");
  execFileSync(ffmpeg, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:d=300",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=300",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    media,
  ]);
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
      video: { codec: "h264", width: 1280, height: 720, fpsNum: 30, fpsDen: 1 },
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
  // A second stream with 250 messages, for loading older ones on scroll.
  const chat = join(streams, "Long Chat.alcyo");
  mkdirSync(join(chat, "thread"), { recursive: true });
  json(join(chat, "project.json"), { schemaVersion: 1, streamId: "s_longchat01", name: "Long Chat", createdAt: AT, sources: [], shorts: [], clips: [], settings: { copyIntoProject: false }, autoFindAt: AT });
  writeFileSync(join(chat, "thread", "messages.jsonl"), Array.from({ length: 250 }, (_, i) => JSON.stringify({ id: `m_chat${String(i).padStart(4, "0")}`, rev: 0, at: AT, author: i % 2 === 0 ? "user" : "app", body: { kind: "text", text: `Message ${i}` } })).join("\n") + "\n");
  json(join(userData, "streams.json"), {
    schemaVersion: 1,
    streams: [
      { streamId, folder, name: "Boss Fight Stream", thumbnail: null, lastActivityAt: AT, unread: false, preview: "" },
      { streamId: "s_longchat01", folder: chat, name: "Long Chat", thumbnail: null, lastActivityAt: "2026-10-01T12:00:00.000Z", unread: false, preview: "" },
    ],
  });
  return folder;
} // prettier-ignore
