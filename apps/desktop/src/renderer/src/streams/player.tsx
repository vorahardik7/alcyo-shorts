// The short preview (plan section 18). The same crop function and the same
// .ass file as the render: cropWindow drives a CSS transform on the video,
// and JASSUB draws the .ass on a canvas at the short's own time.
//
// Playback across cuts uses two <video> elements. While A plays segment n,
// B waits at the start of n+1; at A's segment end they swap.
import type { ChannelOutput } from "@alcyo/ipc";
import { cropWindow } from "@alcyo/render";
import type { Segment } from "@alcyo/schema";
import JASSUB from "jassub";
import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Spinner } from "../ui/parts";

export type Preview = ChannelOutput<"short:preview">;

/** One player plays at a time, across the whole window. */
export const usePlaying = create<{ key: string | null; set: (key: string | null) => void }>(
  (set) => ({ key: null, set: (key) => set({ key }) }),
);

const FONT_URL = (file: string) => `alcyo-media://fonts/${file}`;
/** The bundled fonts, as libass names them (BUNDLED_FONTS in schema). */
const FONTS: Record<string, string> = {
  inter: FONT_URL("Inter-Regular.ttf"),
  "inter semibold": FONT_URL("Inter-SemiBold.ttf"),
  "inter black": FONT_URL("Inter-Black.ttf"),
  anton: FONT_URL("Anton-Regular.ttf"),
  "montserrat extrabold": FONT_URL("Montserrat-ExtraBold.ttf"),
};

/** Where each segment starts in short time. */
function starts(segments: readonly Segment[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of segments) {
    out.push(acc);
    acc += s.srcOut - s.srcIn;
  }
  return out;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Whether an element is on screen, and whether it has been at all. */
export function useVisible<T extends Element>(): [
  React.RefObject<T | null>,
  { visible: boolean; seen: boolean },
] {
  const ref = useRef<T>(null);
  const [state, setState] = useState({ visible: false, seen: false });
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const io = new IntersectionObserver(
      ([e]) => {
        const visible = e?.isIntersecting === true;
        setState((s) => ({ visible, seen: s.seen || visible }));
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, state];
}

export function ShortPlayer({
  preview,
  playKey,
  className = "",
}: {
  preview: Preview;
  /** Unique per card, for one-at-a-time playback. */
  playKey: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const vidA = useRef<HTMLVideoElement>(null);
  const vidB = useRef<HTMLVideoElement>(null);
  /** Set once JASSUB is ready. Before that its renderer doesn't exist yet. */
  const subs = useRef<JASSUB | null>(null);
  const timeRef = useRef(0);
  const at = useRef({ vid: 0, seg: 0 });
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const setPlayingKey = usePlaying((s) => s.set);

  const short = preview.version.short;
  const segs = short.segments;
  const offs = starts(segs);
  const total = offs.at(-1)! + (segs.at(-1)!.srcOut - segs.at(-1)!.srcIn);

  // Box width, for the crop scale.
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const ro = new ResizeObserver(([e]) => setWidth(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Places the videos for short time t and draws the captions at t. */
  const draw = useCallback(
    (t: number) => {
      const w = box.current?.clientWidth ?? 0;
      if (w === 0) return;
      const crop = cropWindow(
        short.crop.keys,
        Math.min(t, Math.max(0, total - 1)),
        preview.width,
        preview.height,
      );
      const scale = w / crop.w;
      [vidA.current, vidB.current].forEach((v, i) => {
        if (v === null) return;
        v.style.width = `${preview.width * scale}px`;
        v.style.height = `${preview.height * scale}px`;
        v.style.transform = `translate(${-crop.x * scale}px, ${-crop.y * scale}px)`;
        v.style.visibility = i === at.current.vid ? "visible" : "hidden";
      });
      box.current?.setAttribute("data-crop-x", String(crop.x));
      void subs.current
        ?.manualRender({
          expectedDisplayTime: performance.now(),
          width: 1080,
          height: 1920,
          mediaTime: t / 1000,
        })
        .catch(() => undefined);
    },
    [short, total, preview.width, preview.height],
  );

  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  /** Seeks to the start: A at segment 0, B at segment 1. */
  const reset = useCallback(() => {
    at.current = { vid: 0, seg: 0 };
    const [a, b] = [vidA.current, vidB.current];
    if (a !== null) a.currentTime = segs[0]!.srcIn / 1000;
    if (b !== null && segs[1] !== undefined) b.currentTime = segs[1].srcIn / 1000;
    setTime(0);
    draw(0);
  }, [segs, draw]);

  // Captions: one JASSUB per mounted player and .ass.
  useEffect(() => {
    const c = canvas.current;
    if (c === null) return;
    let gone = false;
    let inst: JASSUB | null = null;
    try {
      inst = new JASSUB({
        canvas: c,
        subContent: preview.ass,
        // Loaded before ready, so the first frame already has them.
        fonts: Object.values(FONTS),
        defaultFont: "inter",
        queryFonts: false,
      });
      // For tests: frame readback through the same renderer.
      (c as HTMLCanvasElement & { jassub?: JASSUB }).jassub = inst;
      void inst.ready
        .then(async () => {
          if (gone || inst === null) return;
          await inst.resize(true);
          subs.current = inst;
          c.setAttribute("data-ready", "true");
          drawRef.current(timeRef.current);
        })
        .catch(() => undefined);
    } catch {
      subs.current = null;
    }
    return () => {
      gone = true;
      subs.current = null;
      void inst?.destroy().catch(() => undefined);
    };
  }, [preview.ass]);

  useEffect(() => {
    timeRef.current = time;
    draw(time);
  }, [draw, time]);

  // JASSUB sizes its canvas only on resize() in canvas mode.
  useEffect(() => {
    const inst = subs.current;
    if (inst === null || width === 0) return;
    void inst
      .resize(true)
      .then(() => draw(timeRef.current))
      .catch(() => undefined);
  }, [width, draw]);

  const stop = useCallback(() => {
    vidA.current?.pause();
    vidB.current?.pause();
    setPlaying(false);
  }, []);

  // While playing: follow the active video, swap at each cut, stop at the end.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const loop = () => {
      const cur = at.current;
      const vid = (i: number) => (i === 0 ? vidA.current : vidB.current);
      const a = vid(cur.vid);
      const seg = segs[cur.seg];
      if (a === null || seg === undefined) return;
      if (a.currentTime * 1000 >= seg.srcOut - 15) {
        const next = cur.seg + 1;
        if (next >= segs.length) {
          stop();
          reset();
          return;
        }
        const other = 1 - cur.vid;
        void vid(other)
          ?.play()
          .catch(() => undefined);
        a.pause();
        at.current = { vid: other, seg: next };
        // A waits at the segment after next.
        const after = segs[next + 1];
        if (after !== undefined) a.currentTime = after.srcIn / 1000;
      }
      const now = at.current;
      const v = vid(now.vid);
      const s2 = segs[now.seg];
      if (v !== null && s2 !== undefined) {
        const t =
          offs[now.seg]! + Math.max(0, Math.min(s2.srcOut, v.currentTime * 1000) - s2.srcIn);
        setTime(t);
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing, segs, offs, stop, reset]);

  const play = useCallback(() => {
    const v = at.current.vid === 0 ? vidA.current : vidB.current;
    if (v === null) return;
    setPlayingKey(playKey);
    void v.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }, [playKey, setPlayingKey]);

  // Another card started: this one stops.
  useEffect(
    () =>
      usePlaying.subscribe((s) => {
        if (s.key !== playKey) stop();
      }),
    [playKey, stop],
  );

  if (preview.src === null) {
    return (
      <div
        className={`grid aspect-[9/16] place-items-center rounded-xl bg-black/60 px-4 text-center text-[12px] text-tertiary ${className}`}
      >
        The preview shows once the recording or its proxy is ready.
      </div>
    );
  }

  return (
    <div
      ref={box}
      data-testid="short-player"
      data-playing={playing}
      className={`group/player relative aspect-[9/16] overflow-hidden rounded-xl bg-black ${className}`}
    >
      <video
        ref={vidA}
        data-testid="player-video"
        src={preview.src ?? undefined}
        preload="auto"
        playsInline
        className="absolute top-0 left-0 max-w-none origin-top-left"
        onLoadedData={() => {
          setReady(true);
          reset();
        }}
      />
      <video
        ref={vidB}
        src={preview.src ?? undefined}
        preload="auto"
        playsInline
        className="invisible absolute top-0 left-0 max-w-none origin-top-left"
      />
      <canvas
        ref={canvas}
        data-testid="player-captions"
        className="pointer-events-none absolute inset-0 size-full"
      />
      <button
        type="button"
        data-testid="player-toggle"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => (playing ? stop() : play())}
        className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/50 via-transparent to-transparent p-2.5 text-left opacity-100 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-unread focus-visible:ring-inset data-[playing=true]:opacity-0 hover:opacity-100"
        data-playing={playing}
      >
        <span className="grid size-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
          {!ready ? (
            <Spinner size={12} />
          ) : playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <rect x="2" y="1.5" width="2.8" height="9" rx="0.8" fill="currentColor" />
              <rect x="7.2" y="1.5" width="2.8" height="9" rx="0.8" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path
                d="M3 1.8v8.4c0 .5.5.8 1 .5l6.8-4.2c.4-.3.4-.8 0-1L4 1.3c-.5-.3-1 0-1 .5Z"
                fill="currentColor"
              />
            </svg>
          )}
        </span>
        <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white tabular-nums backdrop-blur">
          {fmt(time)} / {fmt(total)}
        </span>
      </button>
    </div>
  );
}
