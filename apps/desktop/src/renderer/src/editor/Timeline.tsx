// The timeline (plan section 6): video segments with thumbnails and the
// waveform, kept caption words, the hook and crop keyframes, in short time.
// Drag a segment edge to trim, drag keyframes and hook edges to move them,
// click or drag the ruler to seek, Shift-drag to select a range. Edges snap
// to words, pauses and the playhead (hold Alt to place freely).
import type { EditorView } from "@alcyo/ipc";
import {
  type Short,
  isWordKept,
  moveCropKey,
  setHook,
  shortDuration,
  shortToSource,
  snapTo,
  sourceToShort,
  trimSegment,
} from "@alcyo/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtTime } from "../streams/player";
import { ZOOM_STEPS, useEditor } from "./store";

const SNAP_PX = 8;
const PAD = 16;

/** The waveform for the editor's window: Int8 min/max pairs, 100 per second. */
function usePeaks(view: EditorView): { from: number; data: Int8Array } | null {
  const [peaks, setPeaks] = useState<{ from: number; data: Int8Array } | null>(null);
  useEffect(() => {
    const url = view.source.peaks;
    if (url === null) return;
    let live = true;
    const a = Math.floor(view.window.fromMs / 10);
    const b = Math.ceil(view.window.toMs / 10);
    fetch(url, { headers: { Range: `bytes=${a * 2}-${b * 2 - 1}` } })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => live && setPeaks({ from: a, data: new Int8Array(buf) }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [view.source.peaks, view.window.fromMs, view.window.toMs]);
  return peaks;
}

function Waveform({
  seg,
  width,
  peaks,
}: {
  seg: { srcIn: number; srcOut: number };
  width: number;
  peaks: { from: number; data: Int8Array } | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (c == null || ctx == null || peaks === null) return;
    const w = Math.max(1, Math.round(width));
    c.width = w;
    c.height = 40;
    ctx.clearRect(0, 0, w, 40);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (let x = 0; x < w; x++) {
      const a = Math.floor((seg.srcIn + ((seg.srcOut - seg.srcIn) * x) / w) / 10) - peaks.from;
      const b = Math.max(
        a + 1,
        Math.floor((seg.srcIn + ((seg.srcOut - seg.srcIn) * (x + 1)) / w) / 10) - peaks.from,
      );
      let lo = 0;
      let hi = 0;
      for (let i = Math.max(0, a); i < b && i * 2 + 1 < peaks.data.length; i++) {
        lo = Math.min(lo, peaks.data[i * 2]!);
        hi = Math.max(hi, peaks.data[i * 2 + 1]!);
      }
      const y0 = 20 - (hi / 128) * 18;
      const y1 = 20 - (lo / 128) * 18;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }, [seg.srcIn, seg.srcOut, width, peaks]);
  return (
    <canvas ref={ref} className="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full" />
  );
}

type Drag =
  | { kind: "trim"; index: number; edge: "in" | "out"; x0: number; result: Short | null }
  | { kind: "key"; index: number; x0: number; t: number }
  | { kind: "hook"; edge: "start" | "end"; x0: number; t: number }
  | { kind: "scrub" }
  | { kind: "select"; from: number };

export function Timeline() {
  const view = useEditor((s) => s.view)!;
  const short = useEditor((s) => s.history.present.value);
  const sel = useEditor((s) => s.sel);
  const keySel = useEditor((s) => s.key);
  const zoom = useEditor((s) => s.zoom);
  const pps = useEditor((s) => s.pxPerSec)();
  const set = useEditor((s) => s.set);
  const seek = useEditor((s) => s.seek);
  const apply = useEditor((s) => s.apply);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const peaks = usePeaks(view);

  const shown = drag?.kind === "trim" && drag.result !== null ? drag.result : short;
  const dur = shortDuration(shown.segments);
  const px = (ms: number) => PAD + (ms / 1000) * pps;
  const msAt = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect();
    const x = clientX - r.left + scroller.current!.scrollLeft - PAD;
    return Math.max(0, Math.min(dur, Math.round((x / pps) * 1000)));
  };
  const snapMs = (SNAP_PX / pps) * 1000;

  // Snap points in source time, for trims: word edges, pauses, the playhead.
  const srcSnaps = useMemo(() => {
    const pts: number[] = [];
    for (const w of view.words) pts.push(w.startMs, w.endMs);
    for (const s of view.silences) pts.push(s.startMs, s.endMs);
    return pts;
  }, [view.words, view.silences]);
  // Snap points in short time, for keys and the hook: kept word edges, cuts, the playhead.
  const shortSnaps = useMemo(() => {
    const pts: number[] = [];
    let acc = 0;
    for (const s of short.segments) {
      pts.push(acc);
      acc += s.srcOut - s.srcIn;
    }
    pts.push(acc);
    for (const w of view.words) {
      const a = sourceToShort(short.segments, w.startMs);
      if (a !== null) pts.push(a);
    }
    return pts;
  }, [short.segments, view.words]);

  const onMove = (e: React.PointerEvent) => {
    if (drag === null) return;
    const t = useEditor.getState().t;
    const free = e.altKey;
    if (drag.kind === "scrub") seek(msAt(e.clientX));
    else if (drag.kind === "select") {
      const b = msAt(e.clientX);
      set({ sel: { from: Math.min(drag.from, b), to: Math.max(drag.from, b) } });
    } else if (drag.kind === "trim") {
      const seg = short.segments[drag.index]!;
      const deltaMs = ((e.clientX - drag.x0) / pps) * 1000;
      const raw = (drag.edge === "in" ? seg.srcIn : seg.srcOut) + deltaMs;
      const playSrc = shortToSource(short.segments, t);
      const pts = playSrc === null ? srcSnaps : [...srcSnaps, playSrc];
      const at = free ? raw : snapTo(raw, pts, snapMs);
      const r = trimSegment(short, drag.index, drag.edge, at, view.source.durationMs);
      setDrag({ ...drag, result: r.ok ? r.value : null });
    } else if (drag.kind === "key" || drag.kind === "hook") {
      const raw = msAt(e.clientX);
      setDrag({ ...drag, t: free ? raw : snapTo(raw, [...shortSnaps, t], snapMs) });
    }
  };

  const onUp = () => {
    if (drag === null) return;
    if (drag.kind === "trim" && drag.result !== null) {
      const result = drag.result;
      apply("Trimmed", () => result);
    } else if (drag.kind === "key") {
      apply("Moved a keyframe", (s) => moveCropKey(s, drag.index, drag.t));
    } else if (drag.kind === "hook") {
      apply(drag.edge === "start" ? "Hook start" : "Hook end", (s) =>
        s.hook === undefined ? s : setHook(s, { ...s.hook, [drag.edge]: drag.t }),
      );
    }
    setDrag(null);
  };

  const keptWords = useMemo(
    () => view.words.filter((w) => isWordKept(shown, w)),
    [view.words, shown],
  );
  const offsets: number[] = [];
  {
    let acc = 0;
    for (const s of shown.segments) {
      offsets.push(acc);
      acc += s.srcOut - s.srcIn;
    }
  }
  const width = px(dur) + PAD;
  const ticks: number[] = [];
  const step = pps >= 80 ? 1000 : pps >= 30 ? 2000 : 5000;
  for (let ms = 0; ms <= dur; ms += step) ticks.push(ms);
  const hookShown =
    shown.hook === undefined
      ? undefined
      : drag?.kind === "hook"
        ? { ...shown.hook, [drag.edge]: drag.t }
        : shown.hook;

  return (
    <div data-testid="timeline" className="flex min-h-0 flex-col">
      <div className="flex min-h-0">
        {/* Track names, fixed while the tracks scroll. Heights match the rows. */}
        <div
          aria-hidden
          className="w-[76px] shrink-0 border-r border-hairline text-[11px] font-medium text-tertiary"
        >
          <div className="h-6 border-b border-hairline" />
          <div className="flex h-16 items-center px-3">Video</div>
          <div className="flex h-7 items-center border-t border-hairline px-3">Captions</div>
          <div className="flex h-6 items-center border-t border-hairline px-3">Hook</div>
          <div className="flex h-6 items-center border-t border-hairline px-3">Reframe</div>
        </div>
        <div
          ref={scroller}
          className="relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden select-none"
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
        >
          <div className="relative" style={{ width }}>
            {/* Ruler */}
            <div
              data-testid="ruler"
              className="relative h-6 cursor-text border-b border-hairline text-[10px] text-tertiary tabular-nums"
              onPointerDown={(e) => {
                e.currentTarget.parentElement!.parentElement!.setPointerCapture(e.pointerId);
                const at = msAt(e.clientX);
                if (e.shiftKey) {
                  setDrag({ kind: "select", from: at });
                  set({ sel: { from: at, to: at } });
                } else {
                  setDrag({ kind: "scrub" });
                  set({ sel: null });
                  seek(at);
                }
              }}
            >
              {ticks.map((ms) => (
                <span key={ms} className="absolute top-1 -translate-x-1/2" style={{ left: px(ms) }}>
                  {fmtTime(ms)}
                </span>
              ))}
            </div>

            {/* Video */}
            <div className="relative h-16">
              {shown.segments.map((s, i) => {
                const left = px(offsets[i]!);
                const w = ((s.srcOut - s.srcIn) / 1000) * pps;
                const tiles = Math.max(1, Math.ceil(w / 64));
                const { count, everyMs, base } = view.source.thumbs;
                return (
                  <div
                    key={i}
                    data-testid="segment"
                    data-src-in={s.srcIn}
                    data-src-out={s.srcOut}
                    className="absolute top-1.5 bottom-1.5 overflow-hidden rounded-md bg-[#1d2a44] ring-1 ring-accent/40"
                    style={{ left, width: Math.max(2, w - 1) }}
                  >
                    {count > 0 && (
                      <div className="pointer-events-none absolute inset-0 flex opacity-40">
                        {Array.from({ length: tiles }, (_, k) => {
                          const src = s.srcIn + ((s.srcOut - s.srcIn) * (k + 0.5)) / tiles;
                          const n = Math.min(count, Math.max(1, Math.floor(src / everyMs) + 1));
                          return (
                            <img
                              key={k}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              src={`${base}/${n}`}
                              className="h-full flex-1 object-cover"
                            />
                          );
                        })}
                      </div>
                    )}
                    <Waveform seg={s} width={w} peaks={peaks} />
                    <span className="pointer-events-none absolute top-1 left-2 rounded bg-black/40 px-1 text-[10px] text-secondary tabular-nums">
                      {fmtTime(s.srcIn)}
                    </span>
                    {(["in", "out"] as const).map((edge) => (
                      <span
                        key={edge}
                        data-testid={`trim-${edge}`}
                        role="slider"
                        aria-label={`Trim the ${edge === "in" ? "start" : "end"} of segment ${i + 1}`}
                        aria-valuenow={edge === "in" ? s.srcIn : s.srcOut}
                        className={`absolute inset-y-0 w-2 cursor-ew-resize bg-unread/70 opacity-0 hover:opacity-100 ${edge === "in" ? "left-0 rounded-l-md" : "right-0 rounded-r-md"} ${drag?.kind === "trim" && drag.index === i && drag.edge === edge ? "opacity-100" : ""}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          scroller.current!.setPointerCapture(e.pointerId);
                          setDrag({ kind: "trim", index: i, edge, x0: e.clientX, result: null });
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Captions */}
            <div className="relative h-7 border-t border-hairline">
              {keptWords.map((w) => {
                const a = sourceToShort(shown.segments, w.startMs);
                if (a === null) return null;
                const hidden = shown.captions.overrides.find((o) => o.wordId === w.id)?.hidden;
                return (
                  <button
                    key={w.id}
                    type="button"
                    data-testid="caption-chip"
                    onClick={() => {
                      set({ words: { anchor: w.id, focus: w.id }, panel: "captions" });
                      seek(a);
                    }}
                    className={`absolute top-1 h-5 truncate rounded-[3px] px-0.5 text-left text-[10px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-unread ${hidden === true ? "bg-white/[0.03] text-tertiary/70 line-through" : "bg-white/[0.14] text-secondary hover:bg-white/[0.2] hover:text-text"}`}
                    style={{
                      left: px(a),
                      width: Math.max(4, ((w.endMs - w.startMs) / 1000) * pps),
                    }}
                    title={w.text}
                    aria-label={w.text}
                  >
                    {/* Too narrow to read: a plain block; the word shows on hover. */}
                    {((w.endMs - w.startMs) / 1000) * pps >= 28 ? w.text : null}
                  </button>
                );
              })}
            </div>

            {/* Hook */}
            <div className="relative h-6 border-t border-hairline">
              {hookShown !== undefined && (
                <div
                  data-testid="hook-bar"
                  className="absolute top-1 h-4 rounded-sm bg-[#facc15]/25 text-[10px] leading-4 text-[#fde68a] ring-1 ring-[#facc15]/40"
                  style={{
                    left: px(hookShown.start),
                    width: Math.max(4, px(hookShown.end) - px(hookShown.start)),
                  }}
                >
                  <span className="pointer-events-none truncate px-1.5">{hookShown.text}</span>
                  {(["start", "end"] as const).map((edge) => (
                    <span
                      key={edge}
                      data-testid={`hook-${edge}-handle`}
                      className={`absolute inset-y-0 w-1.5 cursor-ew-resize bg-[#facc15]/70 opacity-0 hover:opacity-100 ${edge === "start" ? "left-0" : "right-0"}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        scroller.current!.setPointerCapture(e.pointerId);
                        setDrag({ kind: "hook", edge, x0: e.clientX, t: hookShown[edge] });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Crop keys */}
            <div className="relative h-6 border-t border-hairline">
              {shown.crop.keys.map((k, i) => {
                const at = drag?.kind === "key" && drag.index === i ? drag.t : k.t;
                return (
                  <button
                    key={`${k.t}-${i}`}
                    type="button"
                    data-testid="key-diamond"
                    aria-label={`Keyframe at ${fmtTime(k.t)}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      scroller.current!.setPointerCapture(e.pointerId);
                      set({ key: i, panel: "reframe" });
                      setDrag({ kind: "key", index: i, x0: e.clientX, t: k.t });
                    }}
                    className={`absolute top-1.5 size-3 -translate-x-1/2 rotate-45 rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-unread ${keySel === i ? "bg-unread" : k.ease === "hold" ? "bg-white/70" : "bg-[#9DB8FF]"}`}
                    style={{ left: px(at) }}
                  />
                );
              })}
            </div>

            {sel !== null && sel.to > sel.from && (
              <div
                data-testid="selection"
                className="pointer-events-none absolute top-6 bottom-0 bg-unread/15 ring-1 ring-unread/50"
                style={{ left: px(sel.from), width: px(sel.to) - px(sel.from) }}
              />
            )}
            <TimelinePlayhead pps={pps} duration={dur} scroller={scroller} />
          </div>
        </div>
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-hairline px-3 text-[11px] text-tertiary">
        <span className="tabular-nums">
          <TimelineTime duration={dur} />
        </span>
        {sel !== null && sel.to > sel.from && (
          <span className="tabular-nums text-secondary">
            Selected {((sel.to - sel.from) / 1000).toFixed(1)} s · Delete to cut
          </span>
        )}
        <span className="flex-1" />
        <span>Shift-drag the ruler to select · Alt to place freely</span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out (−)"
            disabled={zoom === 0}
            onClick={() => set({ zoom: Math.max(0, zoom - 1) })}
            className="grid size-6 place-items-center rounded-md text-[14px] text-secondary outline-none hover:bg-white/[0.06] hover:text-text focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30"
          >
            −
          </button>
          <span className="w-12 text-center tabular-nums">Zoom {zoom + 1}</span>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in (+)"
            disabled={zoom === ZOOM_STEPS.length - 1}
            onClick={() => set({ zoom: Math.min(ZOOM_STEPS.length - 1, zoom + 1) })}
            className="grid size-6 place-items-center rounded-md text-[14px] text-secondary outline-none hover:bg-white/[0.06] hover:text-text focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30"
          >
            +
          </button>
        </span>
      </div>
    </div>
  );
}

/** Only the playhead and its small time label subscribe to frame ticks. */
function TimelinePlayhead({
  pps,
  duration,
  scroller,
}: {
  pps: number;
  duration: number;
  scroller: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useEditor((s) => s.t);
  const x = PAD + (Math.min(t, duration) / 1000) * pps;
  useEffect(() => {
    const el = scroller.current;
    if (el !== null && (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40))
      el.scrollTo({ left: Math.max(0, x - el.clientWidth / 3) });
  }, [x, scroller]);
  return (
    <div
      data-testid="playhead"
      className="pointer-events-none absolute top-0 bottom-0 w-px bg-white"
      style={{ left: x }}
    />
  );
}
function TimelineTime({ duration }: { duration: number }) {
  const second = useEditor((s) => Math.floor(s.t / 1000));
  return (
    <>
      {fmtTime(second * 1000)} / {fmtTime(duration)}
    </>
  );
}
