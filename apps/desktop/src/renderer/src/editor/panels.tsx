// The editor's side panels (plan section 6): the transcript, captions,
// reframe and hook. Every change goes through the store's apply(), so it can
// be undone.
import {
  type CropKey,
  SAFE_AREAS,
  type Short,
  isWordKept,
  nudgeWord,
  restoreWords,
  rippleDeleteWords,
  setCaptionPreset,
  setCropKey,
  setHook,
  setWordOverride,
  setWordsPerLine,
  deleteCropKey,
  shortDuration,
  sourceToShort,
  shortToSource,
  NUDGE_LARGE_MS,
  NUDGE_SMALL_MS,
} from "@alcyo/schema";
import { cropFraction, cropSize } from "@alcyo/render";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { fmtTime } from "../streams/player";
import { current, useEditor } from "./store";

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The selected words, in transcript order, as indexes into view.words. */
export function selectedRange(): [number, number] | null {
  const { view, words } = useEditor.getState();
  if (view === null || words === null) return null;
  const a = view.words.findIndex((w) => w.id === words.anchor);
  const b = view.words.findIndex((w) => w.id === words.focus);
  if (a === -1 || b === -1) return null;
  return a <= b ? [a, b] : [b, a];
}

/** Cuts the selected words (ripple), or puts cut ones back. */
export function cutOrRestoreSelection(): boolean {
  const { view, apply } = useEditor.getState();
  const r = selectedRange();
  if (view === null || r === null) return false;
  const short = current();
  const picked = view.words.slice(r[0], r[1] + 1);
  const kept = picked.filter((w) => isWordKept(short, w));
  const range = { fromWord: picked[0]!.id, toWord: picked.at(-1)!.id };
  const n = picked.length;
  if (kept.length === 0) {
    return apply(`Restored ${n} word${n === 1 ? "" : "s"}`, (s) =>
      restoreWords(s, { words: view.words }, [range]),
    );
  }
  const ok = apply(`Cut ${kept.length} word${kept.length === 1 ? "" : "s"}`, (s) =>
    rippleDeleteWords(s, { words: view.words }, [
      { fromWord: kept[0]!.id, toWord: kept.at(-1)!.id },
    ]),
  );
  if (ok) useEditor.getState().set({ sel: null });
  return ok;
}

export function TranscriptPanel() {
  const view = useEditor((s) => s.view)!;
  const short = useEditor((s) => s.history.present.value);
  // Subscribe to word changes, not every animation-frame tick.
  const activeWord = useEditor((s) => {
    const src = shortToSource(s.history.present.value.segments, s.t);
    if (src === null) return null;
    let lo = 0;
    let hi = view.words.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (view.words[mid]!.startMs <= src) lo = mid + 1;
      else hi = mid;
    }
    const word = view.words[lo - 1];
    return word !== undefined && src < word.endMs ? word.id : null;
  });
  const words = useEditor((s) => s.words);
  const set = useEditor((s) => s.set);
  const seek = useEditor((s) => s.seek);
  const box = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(view.words.map((w, i) => [w.id, i])), [view.words]);
  const range = ((): [number, number] | null => {
    if (words === null) return null;
    const a = byId.get(words.anchor);
    const b = byId.get(words.focus);
    return a === undefined || b === undefined ? null : a <= b ? [a, b] : [b, a];
  })();
  const first = short.segments[0]!.srcIn;
  const last = short.segments.at(-1)!.srcOut;
  // Only lines near the short: 15 s each side.
  const lines = useMemo(
    () => view.lines.filter((l) => l.endMs > first - 15_000 && l.startMs < last + 15_000),
    [view.lines, first, last],
  );

  // Runs of lines that are cut in full fold into one "removed passage" row,
  // unless the selection is in them. Keyed by the run's first line index.
  const [shown, setShown] = useState<Set<number>>(new Set());
  const runs = useMemo(() => {
    const out: ({ start: number; words: number } | undefined)[] = [];
    let current: { start: number; words: number } | undefined;
    lines.forEach((line, n) => {
      const idx = line.wordIds.flatMap((id) => {
        const i = byId.get(id);
        return i === undefined ? [] : [i];
      });
      const cut =
        idx.length > 0 &&
        idx.every((i) => !isWordKept(short, view.words[i]!)) &&
        !idx.some((i) => range !== null && i >= range[0] && i <= range[1]);
      if (!cut) {
        current = undefined;
        out.push(undefined);
        return;
      }
      current ??= { start: n, words: 0 };
      current.words += idx.length;
      out.push(current);
    });
    return out;
  }, [lines, byId, short, view.words, range]);

  // The current word stays in view while playing.
  useEffect(() => {
    box.current
      ?.querySelector('[data-now="true"]')
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeWord]);

  return (
    <div
      ref={box}
      data-testid="transcript-panel"
      className="max-w-[720px] space-y-1.5 text-[15px] leading-[26px]"
    >
      <p
        className="pb-1 text-[12px] leading-snug text-tertiary"
        title="Shift-click to select more. Select cut words and press Delete again to put them back."
      >
        Click a word to jump there. Select words, then press Delete to cut.
      </p>
      {lines.map((line, n) => {
        const run = runs[n];
        const folded = run !== undefined && !shown.has(run.start);
        return (
          <Fragment key={line.id}>
            {run !== undefined && run.start === n && (
              <button
                type="button"
                data-testid="removed-run"
                onClick={() =>
                  setShown((s) => {
                    const next = new Set(s);
                    if (next.has(run.start)) next.delete(run.start);
                    else next.add(run.start);
                    return next;
                  })
                }
                className="flex items-center gap-2 rounded-md py-0.5 text-[12px] text-tertiary outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span aria-hidden className="h-px w-4 bg-line-strong" />
                {folded ? "Show" : "Hide"} removed passage · {run.words}{" "}
                {run.words === 1 ? "word" : "words"}
              </button>
            )}
            <p className={`select-none ${folded ? "hidden" : ""}`}>
              {line.wordIds.map((id) => {
                const i = byId.get(id);
                if (i === undefined) return null;
                const w = view.words[i]!;
                const kept = isWordKept(short, w);
                const picked = range !== null && i >= range[0] && i <= range[1];
                const now = kept && activeWord === w.id;
                return (
                  <span key={id}>
                    <button
                      type="button"
                      data-testid="word"
                      data-word={id}
                      data-kept={kept}
                      data-now={now}
                      onClick={(e) => {
                        if (e.shiftKey && words !== null) set({ words: { ...words, focus: id } });
                        else set({ words: { anchor: id, focus: id } });
                        const st = sourceToShort(short.segments, w.startMs);
                        if (st !== null) seek(st);
                      }}
                      className={`rounded-[4px] px-px outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        picked ? "bg-accent/30 text-text" : now ? "bg-white/15 text-text" : ""
                      } ${kept ? "text-[#e4e5e8] hover:bg-white/[0.06]" : "text-[#5d616a] line-through decoration-[#5d616a]"}`}
                    >
                      {w.text}
                    </button>{" "}
                  </span>
                );
              })}
            </p>
          </Fragment>
        );
      })}
      {lines.length === 0 && (
        <p className="text-[13px] text-tertiary">There&apos;s no transcript for this part.</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[12px] font-medium text-tertiary">{label}</span>
      {children}
    </label>
  );
}

/** A text box with Set. Keyed by its value outside, so it resets when that changes. */
function TextForm({
  initial,
  onSet,
  max,
  testId,
  placeholder,
}: {
  initial: string;
  onSet: (text: string) => void;
  max: number;
  testId: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(initial);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSet(text);
      }}
    >
      <input
        data-testid={testId}
        className={input}
        maxLength={max}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      <Button size="sm" type="submit" data-testid={`${testId}-save`}>
        Set
      </Button>
    </form>
  );
}

const input =
  "h-8 w-full rounded-lg bg-white/[0.04] px-2.5 text-[14px] ring-1 ring-hairline outline-none placeholder:text-tertiary focus-visible:ring-2 focus-visible:ring-unread";

export function CaptionsPanel() {
  const view = useEditor((s) => s.view)!;
  const short = useEditor((s) => s.history.present.value);
  const words = useEditor((s) => s.words);
  const apply = useEditor((s) => s.apply);
  const word = words === null ? undefined : view.words.find((w) => w.id === words.focus);
  const o = short.captions.overrides.find((x) => x.wordId === word?.id);

  return (
    <div data-testid="captions-panel" className="space-y-5">
      <Field label="Caption look">
        <select
          data-testid="caption-preset"
          className={input}
          value={short.captions.presetId}
          onChange={(e) => {
            const p = view.captionPresets.find((x) => x.id === e.target.value);
            if (p !== undefined) {
              apply(`Captions: ${p.name}`, (s) => setCaptionPreset(s, p.id, p.wordsPerLine));
            }
          }}
        >
          {view.captionPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Words per line">
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((n) => (
            <Button
              key={n}
              size="sm"
              data-testid={`wpl-${n}`}
              variant={short.captions.wordsPerLine === n ? "primary" : "secondary"}
              onClick={() => apply(`${n} words per line`, (s) => setWordsPerLine(s, n))}
            >
              {n}
            </Button>
          ))}
        </div>
      </Field>
      <div className="rounded-xl bg-card/60 p-3 ring-1 ring-hairline">
        {word === undefined ? (
          <p className="text-[13px] text-tertiary">
            Pick a word in the transcript or on the timeline to change how its caption reads.
          </p>
        ) : (
          <div className="space-y-3" data-testid="word-editor" data-word={word.id}>
            <Field label={`Caption text for “${word.text}”`}>
              <TextForm
                key={`${word.id}:${o?.text ?? ""}`}
                testId="word-text"
                initial={o?.text ?? word.text}
                max={40}
                onSet={(text) =>
                  apply("Caption text", (s) =>
                    setWordOverride(s, word.id, { text: text.trim() === word.text ? "" : text }),
                  )
                }
              />
            </Field>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                data-testid="word-hide"
                onClick={() =>
                  apply(o?.hidden === true ? "Showed a word" : "Hid a word", (s) =>
                    setWordOverride(s, word.id, { hidden: o?.hidden !== true }),
                  )
                }
              >
                {o?.hidden === true ? "Show in captions" : "Hide from captions"}
              </Button>
              {[-NUDGE_LARGE_MS, -NUDGE_SMALL_MS, NUDGE_SMALL_MS, NUDGE_LARGE_MS].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant="ghost"
                  data-testid={`nudge-${d}`}
                  title={`Move this word's caption ${Math.abs(d)} ms ${d < 0 ? "earlier" : "later"}`}
                  onClick={() => apply("Nudged a word", (s) => nudgeWord(s, word.id, d))}
                >
                  {d > 0 ? "+" : "−"}
                  {Math.abs(d)} ms
                </Button>
              ))}
            </div>
            {o !== undefined && (o.startDelta ?? 0) !== 0 && (
              <p className="text-[12px] text-tertiary">
                Shown {Math.abs(o.startDelta ?? 0)} ms {(o.startDelta ?? 0) < 0 ? "early" : "late"}.
              </p>
            )}
          </div>
        )}
      </div>
      <p className="text-[12px] leading-snug text-tertiary">
        Captions show only kept words. Changes are stored on the short; the transcript stays as it
        was.
      </p>
    </div>
  );
}

/** The full source frame with the 9:16 window, draggable. */
export function ReframePanel() {
  const view = useEditor((s) => s.view)!;
  const short = useEditor((s) => s.history.present.value);
  const t = useEditor((s) => s.t);
  const key = useEditor((s) => s.key);
  const apply = useEditor((s) => s.apply);
  const set = useEditor((s) => s.set);
  const seek = useEditor((s) => s.seek);
  const player = useEditor((s) => s.player);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ease, setEase] = useState<CropKey["ease"]>("hold");
  const [drag, setDrag] = useState<number | null>(null);
  const { width: W, height: H } = view.source;
  const { w } = cropSize(W, H);
  const room = W - w;
  const frac = drag ?? cropFraction(short.crop.keys, t);

  // Draws the source frame from the playing video, so it stays in sync.
  useEffect(() => {
    let id = 0;
    let lastVideo: HTMLVideoElement | null = null;
    let lastTime = -1;
    const paint = () => {
      const c = canvas.current;
      const v = player?.activeVideo() ?? null;
      if (
        c !== null &&
        v !== null &&
        v.readyState >= 2 &&
        (v !== lastVideo || v.currentTime !== lastTime)
      ) {
        lastVideo = v;
        lastTime = v.currentTime;
        c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      }
      id = requestAnimationFrame(paint);
    };
    id = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(id);
  }, [player]);

  const toFrac = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const winW = (w / W) * r.width;
    const left = clientX - r.left - winW / 2;
    return room <= 0 ? 0.5 : Math.max(0, Math.min(1, left / (r.width - winW)));
  };
  const dur = shortDuration(short.segments);

  return (
    <div data-testid="reframe-panel" className="space-y-4">
      <div
        className="relative cursor-grab overflow-hidden rounded-lg bg-black ring-1 ring-hairline active:cursor-grabbing"
        style={{ aspectRatio: `${W} / ${H}` }}
        data-testid="reframe-frame"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(toFrac(e.clientX, e.currentTarget));
        }}
        onPointerMove={(e) => {
          if (drag !== null) setDrag(toFrac(e.clientX, e.currentTarget));
        }}
        onPointerUp={(e) => {
          if (drag === null) return;
          const x = toFrac(e.clientX, e.currentTarget);
          setDrag(null);
          apply("Moved the frame", (s) => setCropKey(s, { t, x, ease }));
        }}
      >
        <canvas ref={canvas} width={480} height={Math.round((480 * H) / W)} className="size-full" />
        <div
          className="absolute inset-0 bg-black/55"
          style={{
            clipPath: `polygon(0 0, ${frac * (1 - w / W) * 100}% 0, ${frac * (1 - w / W) * 100}% 100%, 0 100%, 0 0, 100% 0, 100% 100%, ${(frac * (1 - w / W) + w / W) * 100}% 100%, ${(frac * (1 - w / W) + w / W) * 100}% 0)`,
          }}
        />
        <div
          data-testid="reframe-window"
          data-x={frac.toFixed(3)}
          className="pointer-events-none absolute inset-y-0 rounded-sm ring-2 ring-unread"
          style={{ left: `${frac * (1 - w / W) * 100}%`, width: `${(w / W) * 100}%` }}
        />
      </div>
      <p className="text-[12px] leading-snug text-tertiary">
        Drag the frame to set a keyframe at the playhead ({fmtTime(t)}). Hold keeps the frame still
        until the next keyframe; Linear moves it there.
      </p>
      <div className="flex items-center gap-1.5">
        {(["hold", "linear"] as const).map((e) => (
          <Button
            key={e}
            size="sm"
            data-testid={`ease-${e}`}
            variant={ease === e ? "primary" : "secondary"}
            onClick={() => setEase(e)}
          >
            {e === "hold" ? "Hold" : "Linear"}
          </Button>
        ))}
        <span className="flex-1" />
        <Button
          size="sm"
          data-testid="add-key"
          onClick={() =>
            apply("Added a keyframe", (s) =>
              setCropKey(s, { t, x: cropFraction(s.crop.keys, t), ease }),
            )
          }
        >
          Add keyframe
        </Button>
      </div>
      <ul className="divide-y divide-hairline rounded-xl bg-card/60 ring-1 ring-hairline">
        {short.crop.keys.map((k, i) => (
          <li
            key={`${k.t}-${i}`}
            data-testid="crop-key"
            className={`flex items-center gap-2 px-3 py-1.5 text-[13px] ${key === i ? "bg-white/[0.05]" : ""}`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-unread"
              onClick={() => {
                set({ key: i });
                seek(k.t);
              }}
            >
              {fmtTime(k.t)}.{String(Math.floor((k.t % 1000) / 100))} ·{" "}
              {k.ease === "hold" ? "Hold" : "Linear"} · {Math.round(k.x * 100)}%
            </button>
            <Button
              size="sm"
              variant="ghost"
              data-testid="delete-key"
              disabled={short.crop.keys.length <= 1}
              onClick={() => {
                if (apply("Deleted a keyframe", (s) => deleteCropKey(s, i))) set({ key: null });
              }}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-tertiary">
        {dur > 0 && `${short.crop.keys.length} keyframes`}
      </p>
    </div>
  );
}

const PLATFORM = { tiktok: "TikTok", "youtube-shorts": "YouTube Shorts", reels: "Reels" } as const;

/** Dashed safe-area outlines over the preview, from the profile's platforms. */
export function SafeAreas({ platforms }: { platforms: readonly (keyof typeof SAFE_AREAS)[] }) {
  return (
    <div data-testid="safe-areas" className="pointer-events-none absolute inset-0">
      {platforms.map((p) => {
        const a = SAFE_AREAS[p];
        return (
          <div
            key={p}
            title={PLATFORM[p]}
            className="absolute rounded-md border border-dashed border-white/45"
            style={{
              top: `${a.top * 100}%`,
              bottom: `${a.bottom * 100}%`,
              left: `${a.left * 100}%`,
              right: `${a.right * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}

export function HookPanel() {
  const view = useEditor((s) => s.view)!;
  const short = useEditor((s) => s.history.present.value);
  const t = useEditor((s) => s.t);
  const guides = useEditor((s) => s.guides);
  const set = useEditor((s) => s.set);
  const apply = useEditor((s) => s.apply);
  const hook = short.hook;
  const dur = shortDuration(short.segments);
  const put = (label: string, patch: Partial<NonNullable<Short["hook"]>>) =>
    apply(label, (s) =>
      setHook(s, {
        text: s.hook?.text ?? "",
        start: s.hook?.start ?? 0,
        end: s.hook?.end ?? Math.min(dur, 3000),
        presetId: s.hook?.presetId ?? view.hookPresets[0]!.id,
        ...patch,
      }),
    );

  return (
    <div data-testid="hook-panel" className="space-y-5">
      <Field label="Hook text">
        <TextForm
          key={hook?.text ?? ""}
          testId="hook-text"
          initial={hook?.text ?? ""}
          max={80}
          placeholder="What's on screen first"
          onSet={(text) => put(hook === undefined ? "Added a hook" : "New hook", { text })}
        />
      </Field>
      {hook !== undefined && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Starts at ${sec(hook.start)}`}>
              <Button
                size="sm"
                data-testid="hook-start"
                onClick={() => put("Hook start", { start: t })}
              >
                Set to playhead
              </Button>
            </Field>
            <Field label={`Ends at ${sec(hook.end)}`}>
              <Button size="sm" data-testid="hook-end" onClick={() => put("Hook end", { end: t })}>
                Set to playhead
              </Button>
            </Field>
          </div>
          <Field label="Hook look">
            <select
              data-testid="hook-preset"
              className={input}
              value={hook.presetId}
              onChange={(e) => put("Hook look", { presetId: e.target.value })}
            >
              {view.hookPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Button
            size="sm"
            variant="ghost"
            data-testid="hook-remove"
            onClick={() => apply("Removed the hook", (s) => setHook(s, null))}
          >
            Remove the hook
          </Button>
        </>
      )}
      <label className="flex items-center gap-2 text-[13px] text-secondary">
        <input
          type="checkbox"
          data-testid="toggle-guides"
          checked={guides}
          onChange={(e) => set({ guides: e.target.checked })}
        />
        Show safe areas for {view.platforms.map((p) => PLATFORM[p]).join(", ")}
      </label>
    </div>
  );
}
