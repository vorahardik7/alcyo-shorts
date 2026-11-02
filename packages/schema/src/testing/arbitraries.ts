// fast-check arbitraries for the property tests. Test-only.
import fc from "fast-check";
import type { AppLink } from "../link.ts";
import { SETTINGS_SECTIONS } from "../link.ts";
import type { Message } from "../message.ts";
import { type CreatorProfile, GoodMoment } from "../profile.ts";
import type { CropKey, Segment, Short, ShortVersion, WordOverride } from "../short.ts";
import { shortDuration } from "../time.ts";
import type { Line, Transcript, Word } from "../transcript.ts";

export const MAX_SOURCE_MS = 20_000;

const isoDate = fc
  .date({
    min: new Date("2000-01-01T00:00:00Z"),
    max: new Date("2099-12-31T23:59:59Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

const id = fc.string({ minLength: 1, maxLength: 12 });
const text = (maxLength: number, minLength = 0) => fc.string({ minLength, maxLength });
const unit = fc.double({ min: 0, max: 1, noNaN: true }).filter((x) => !Object.is(x, -0));

/** Sorted, non-overlapping segments with gaps, inside [0, MAX_SOURCE_MS]. */
export const segments: fc.Arbitrary<Segment[]> = fc
  .uniqueArray(fc.integer({ min: 0, max: MAX_SOURCE_MS }), { minLength: 2, maxLength: 12 })
  .map((points) => {
    const sorted = [...points].sort((a, b) => a - b);
    const out: Segment[] = [];
    for (let i = 0; i + 1 < sorted.length; i += 2)
      out.push({ srcIn: sorted[i]!, srcOut: sorted[i + 1]! });
    return out;
  });

function cropKeys(dur: number): fc.Arbitrary<CropKey[]> {
  return fc
    .uniqueArray(fc.integer({ min: 0, max: Math.max(0, dur - 1) }), { minLength: 1, maxLength: 6 })
    .chain((ts) =>
      fc.tuple(
        ...[...ts]
          .sort((a, b) => a - b)
          .map((t) =>
            fc.record({
              t: fc.constant(t),
              x: unit,
              ease: fc.constantFrom("hold" as const, "linear" as const),
            }),
          ),
      ),
    );
}

/** A valid short over the given segments; overrides name the given word ids. */
export function shortOver(segs: Segment[], wordIds: readonly string[] = []): fc.Arbitrary<Short> {
  const dur = shortDuration(segs);
  const hook = fc
    .uniqueArray(fc.integer({ min: 0, max: dur }), { minLength: 2, maxLength: 2 })
    .map((p) => [...p].sort((a, b) => a - b) as [number, number]);
  const overrides =
    wordIds.length === 0
      ? fc.constant<WordOverride[]>([])
      : fc
          .uniqueArray(fc.constantFrom(...wordIds), { maxLength: 4 })
          .map((ids) => ids.map((wordId) => ({ wordId, hidden: true })));
  return fc.record(
    {
      title: text(80, 1),
      reason: text(300),
      segments: fc.constant(segs),
      crop: cropKeys(dur).map((keys) => ({ keys })),
      captions: fc.record({
        presetId: id,
        wordsPerLine: fc.integer({ min: 1, max: 4 }),
        overrides,
      }),
      hook: hook.map(([start, end]) => ({ text: "HOOK", start, end, presetId: "hook" })),
    },
    { requiredKeys: ["title", "reason", "segments", "crop", "captions"] },
  );
}

export const short: fc.Arbitrary<Short> = segments.chain((s) => shortOver(s));

/** Words in time order with gaps, grouped into lines of at most 12 s. */
export const transcript: fc.Arbitrary<Transcript> = fc
  .array(
    fc.record({
      gap: fc.integer({ min: 0, max: 1500 }),
      len: fc.integer({ min: 1, max: 900 }),
      breakAfter: fc.boolean(),
    }),
    { minLength: 1, maxLength: 40 },
  )
  .map((specs) => {
    const words: Word[] = [];
    let t = 0;
    specs.forEach((s, i) => {
      t += s.gap;
      words.push({
        id: `w${String(i + 1).padStart(5, "0")}`,
        text: `word${i}`,
        startMs: t,
        endMs: t + s.len,
        p: 0.9,
      });
      t += s.len;
    });
    const lines: Line[] = [];
    let current: Word[] = [];
    const flush = () => {
      if (current.length === 0) return;
      lines.push({
        id: `L${String(lines.length + 1).padStart(4, "0")}`,
        startMs: current[0]!.startMs,
        endMs: current.at(-1)!.endMs,
        wordIds: current.map((w) => w.id),
      });
      current = [];
    };
    words.forEach((w, i) => {
      if (current.length > 0 && w.endMs - current[0]!.startMs > 12_000) flush();
      current.push(w);
      if (specs[i]!.breakAfter) flush();
    });
    flush();
    return {
      schemaVersion: 1 as const,
      sourceId: "src",
      language: "en",
      model: "small.en",
      words,
      lines,
    };
  });

/** A transcript and a valid short whose segments run along its words. */
export const shortOnTranscript: fc.Arbitrary<{ transcript: Transcript; short: Short }> = transcript
  .filter((t) => t.words.length >= 2)
  .chain((t) =>
    fc
      .uniqueArray(fc.integer({ min: 0, max: t.words.length - 1 }), { minLength: 2, maxLength: 10 })
      .chain((idx) => {
        const sorted = [...idx].sort((a, b) => a - b);
        const segs: Segment[] = [];
        for (let i = 0; i + 1 < sorted.length; i += 2) {
          segs.push({
            srcIn: t.words[sorted[i]!]!.startMs,
            srcOut: t.words[sorted[i + 1]!]!.endMs,
          });
        }
        return shortOver(
          segs,
          t.words.map((w) => w.id),
        ).map((s) => ({ transcript: t, short: s }));
      }),
  );

/** Word ranges over a transcript, from <= to. */
export function wordRanges(t: Transcript, maxLength = 4) {
  return fc.array(
    fc
      .tuple(
        fc.integer({ min: 0, max: t.words.length - 1 }),
        fc.integer({ min: 0, max: t.words.length - 1 }),
      )
      .map(([a, b]) => ({
        fromWord: t.words[Math.min(a, b)]!.id,
        toWord: t.words[Math.max(a, b)]!.id,
      })),
    { minLength: 1, maxLength },
  );
}

/** Silences anywhere in the source, possibly overlapping. */
export const silences = fc.array(
  fc
    .tuple(fc.integer({ min: 0, max: MAX_SOURCE_MS }), fc.integer({ min: 1, max: 3000 }))
    .map(([startMs, len]) => ({ startMs, endMs: startMs + len })),
  { maxLength: 20 },
);

export const version: fc.Arbitrary<ShortVersion> = fc.record({
  schemaVersion: fc.constant(1 as const),
  shortId: id,
  version: fc.integer({ min: 2, max: 10_000 }),
  parent: fc.option(fc.integer({ min: 1, max: 1 }), { nil: null }),
  createdBy: fc.constantFrom("claude" as const, "user" as const),
  createdAt: isoDate,
  fromMessageId: fc.option(id, { nil: null }),
  note: text(200),
  sourceId: id,
  sourceFingerprint: fc.string(),
  short,
});

const shortRef = fc.record({ shortId: id, version: fc.integer({ min: 1, max: 1_000_000 }) });

export const message: fc.Arbitrary<Message> = fc.record(
  {
    id,
    rev: fc.nat(),
    at: isoDate,
    author: fc.constantFrom("user" as const, "claude" as const, "app" as const),
    replyTo: shortRef,
    body: fc.oneof(
      fc.record({ kind: fc.constant("text" as const), text: text(4000) }),
      fc.record({
        kind: fc.constant("status" as const),
        jobId: id,
        label: fc.string(),
        pct: fc.double({ min: 0, max: 100, noNaN: true }).filter((x) => !Object.is(x, -0)),
        state: fc.constantFrom(
          "running" as const,
          "done" as const,
          "failed" as const,
          "cancelled" as const,
        ),
      }),
      fc.record({
        kind: fc.constant("shorts" as const),
        intro: text(1000),
        shorts: fc.array(shortRef, { minLength: 1, maxLength: 5 }),
      }),
      fc.record({ kind: fc.constant("version" as const), ref: shortRef, whatChanged: text(300) }),
      fc.record({ kind: fc.constant("render" as const), renderId: id }),
      fc.record({ kind: fc.constant("clips" as const), clipIds: fc.array(id) }),
      fc.record({
        kind: fc.constant("question" as const),
        text: text(500),
        chips: fc.array(text(40), { maxLength: 6 }),
      }),
    ),
  },
  { requiredKeys: ["id", "rev", "at", "author", "body"] },
);

const ms = fc.integer({ min: 0, max: 10_000_000 });

export const profile: fc.Arbitrary<CreatorProfile> = fc.record({
  schemaVersion: fc.constant(1 as const),
  name: text(80),
  streams: text(300),
  audience: text(300),
  goodMoments: fc.uniqueArray(fc.constantFrom(...GoodMoment.options)),
  lengthMs: fc.tuple(ms, ms).map(([a, b]) => ({ min: Math.min(a, b), max: Math.max(a, b) })),
  titleRules: text(500),
  exampleTitles: fc.array(text(80), { maxLength: 5 }),
  avoid: fc.array(text(80), { maxLength: 20 }),
  platforms: fc.uniqueArray(
    fc.constantFrom("tiktok" as const, "youtube-shorts" as const, "reels" as const),
  ),
  captionPresetId: id,
  hookPresetId: id,
  style: fc.record(
    {
      summary: text(800),
      firstWordMs: ms,
      wordsPerSecond: fc.double({ min: 0, max: 20, noNaN: true }).filter((x) => !Object.is(x, -0)),
      cutEveryMs: ms,
      sampleCount: fc.nat({ max: 50 }),
    },
    { requiredKeys: ["summary", "sampleCount"] },
  ),
});

/** Ids with any characters, short enough that the link stays under 2048 chars. */
const linkId = fc.string({ unit: "grapheme", minLength: 1, maxLength: 8 });

/** AppLinks in canonical form: edit only with a version, and only true. */
export const appLink: fc.Arbitrary<AppLink> = fc.oneof(
  fc.record({ to: fc.constant("stream" as const), streamId: linkId }),
  fc.record({ to: fc.constant("message" as const), streamId: linkId, messageId: linkId }),
  fc.record({ to: fc.constant("short" as const), streamId: linkId, shortId: linkId }),
  fc.record({
    to: fc.constant("short" as const),
    streamId: linkId,
    shortId: linkId,
    version: fc.integer({ min: 1, max: 999_999_999 }),
  }),
  fc.record({
    to: fc.constant("short" as const),
    streamId: linkId,
    shortId: linkId,
    version: fc.integer({ min: 1, max: 999_999_999 }),
    edit: fc.constant(true),
  }),
  fc.record({ to: fc.constant("source" as const), streamId: linkId }),
  // The parser takes up to 12 digits of t, about 31 years of ms.
  fc.record({
    to: fc.constant("source" as const),
    streamId: linkId,
    t: fc.integer({ min: 0, max: 999_999_999_999 }),
  }),
  fc.record({ to: fc.constant("settings" as const) }),
  fc.record({
    to: fc.constant("settings" as const),
    section: fc.constantFrom(...SETTINGS_SECTIONS),
  }),
  fc.constantFrom<AppLink>({ to: "renders" }, { to: "profile" }, { to: "setup" }),
);
