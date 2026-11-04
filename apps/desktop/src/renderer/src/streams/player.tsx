// The short preview (plan section 18). The same crop function and the same
// .ass file as the render: cropWindow drives a CSS transform on the video,
// and JASSUB draws the .ass on a canvas at the short's own time.
//
// Playback across cuts uses two <video> elements. While A plays segment n,
// B waits at the start of n+1; at A's segment end they swap. Cards use it as
// is; the editor drives it through a PlayerHandle.
import type { ChannelOutput } from "@alcyo/ipc";
import { cropWindow } from "@alcyo/render";
import { type Segment, type Short, shortDuration } from "@alcyo/schema";
import JASSUB from "jassub";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { create } from "zustand";
import { Spinner } from "../ui/parts";

export type Preview = ChannelOutput<"short:preview">;

/** One player plays at a time, across the whole window. */
export const usePlaying = create<{ key: string | null; set: (key: string | null) => void }>(
  (set) => ({ key: null, set: (key) => set({ key }) }),
);

const FONT_URL = (file: string) => `alcyo-media://fonts/${file}`;
/** The bundled fonts (BUNDLED_FONTS in schema), loaded before JASSUB is ready. */
const FONTS = [
  FONT_URL("Inter-Regular.ttf"),
  FONT_URL("Inter-SemiBold.ttf"),
  FONT_URL("Inter-Black.ttf"),
  FONT_URL("Anton-Regular.ttf"),
  FONT_URL("Montserrat-ExtraBold.ttf"),
];

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

export const fmtTime = (ms: number) => {
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

export interface PlayerHandle {
  seek(tMs: number): void;
  play(rate?: number): void;
  pause(): void;
  toggle(): void;
  isPlaying(): boolean;
  /** The video showing now, for the reframe view. */
  activeVideo(): HTMLVideoElement | null;
}

export interface PlayerProps {
  short: Short;
  src: string | null;
  width: number;
  height: number;
  ass: string;
  /** Unique per player, for one-at-a-time playback. */
  playKey: string;
  className?: string;
  /** Called with the short time as it plays or seeks. */
  onTime?: (tMs: number) => void;
  handle?: Ref<PlayerHandle>;
  /** Drawn over the video and captions (safe-area guides). */
  overlay?: ReactNode;
  /** Hide the built-in play button and time (the editor has its own). */
  bare?: boolean;
}

/** The card's player: a preview from main. */
export function ShortPlayer({
  preview,
  ...rest
}: { preview: Preview } & Omit<PlayerProps, "short" | "src" | "width" | "height" | "ass">) {
  return (
    <Player
      short={preview.version.short}
      src={preview.src}
      width={preview.width}
      height={preview.height}
      ass={preview.ass}
      {...rest}
    />
  );
}

export function Player({
  short,
  src,
  width: srcW,
  height: srcH,
  ass,
  playKey,
  className = "",
  onTime,
  handle,
  overlay,
  bare = false,
}: PlayerProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const vidA = useRef<HTMLVideoElement>(null);
  const vidB = useRef<HTMLVideoElement>(null);
  /** Set once JASSUB is ready. Before that its renderer doesn't exist yet. */
  const subs = useRef<JASSUB | null>(null);
  const timeRef = useRef(0);
  const at = useRef({ vid: 0, seg: 0 });
  const [boxW, setBoxW] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const setPlayingKey = usePlaying((s) => s.set);
  const onTimeRef = useRef(onTime);
  useEffect(() => {
    onTimeRef.current = onTime;
  }, [onTime]);

  const segs = short.segments;
  // Stable per cut list, so effects keyed on them run only after an edit.
  const offs = useMemo(() => starts(segs), [segs]);
  const total = useMemo(() => shortDuration(segs), [segs]);

  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const ro = new ResizeObserver(([e]) => setBoxW(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vid = (i: number) => (i === 0 ? vidA.current : vidB.current);

  /** Places the videos for short time t and draws the captions at t. */
  const draw = useCallback(
    (t: number, repaint = false) => {
      const w = box.current?.clientWidth ?? 0;
      if (w === 0) return;
      const crop = cropWindow(short.crop.keys, Math.min(t, Math.max(0, total - 1)), srcW, srcH);
      const scale = w / crop.w;
      [vidA.current, vidB.current].forEach((v, i) => {
        if (v === null) return;
        v.style.width = `${srcW * scale}px`;
        v.style.height = `${srcH * scale}px`;
        v.style.transform = `translate(${-crop.x * scale}px, ${-crop.y * scale}px)`;
        v.style.visibility = i === at.current.vid ? "visible" : "hidden";
      });
      box.current?.setAttribute("data-crop-x", String(crop.x));
      void subs.current
        ?.manualRender(
          {
            expectedDisplayTime: performance.now(),
            width: 1080,
            height: 1920,
            mediaTime: t / 1000,
          },
          repaint,
        )
        .catch(() => undefined);
    },
    [short, total, srcW, srcH],
  );
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const setT = useCallback((t: number) => {
    timeRef.current = t;
    setTime(t);
    onTimeRef.current?.(t);
  }, []);

  /** Puts both videos where short time t needs them. */
  const seekTo = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(Math.max(0, total - 1), Math.round(t)));
      let seg = 0;
      while (seg + 1 < segs.length && offs[seg + 1]! <= clamped) seg++;
      at.current = { vid: 0, seg };
      const a = vidA.current;
      const b = vidB.current;
      if (a !== null) a.currentTime = (segs[seg]!.srcIn + (clamped - offs[seg]!)) / 1000;
      const next = segs[seg + 1];
      if (b !== null && next !== undefined) b.currentTime = next.srcIn / 1000;
      setT(clamped);
      draw(clamped);
    },
    [segs, offs, total, draw, setT],
  );

  // Captions: one JASSUB per mounted player; a new .ass replaces the track.
  const assRef = useRef(ass);
  useEffect(() => {
    const c = canvas.current;
    if (c === null) return;
    let gone = false;
    let inst: JASSUB | null = null;
    try {
      inst = new JASSUB({
        canvas: c,
        subContent: assRef.current,
        fonts: FONTS,
        defaultFont: "inter",
        queryFonts: false,
      });
      // For tests: frame readback through the same renderer.
      (c as HTMLCanvasElement & { jassub?: JASSUB }).jassub = inst;
      void inst.ready
        .then(async () => {
          if (gone || inst === null) return;
          await inst.resize(true);
          if (assRef.current !== ass) await inst.renderer.setTrack(assRef.current);
          subs.current = inst;
          c.setAttribute("data-ready", "true");
          drawRef.current(timeRef.current, true);
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
    // One renderer per mount; track changes go through setTrack below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    assRef.current = ass;
    const inst = subs.current;
    if (inst === null) return;
    void inst.renderer
      .setTrack(ass)
      .then(() => drawRef.current(timeRef.current, true))
      .catch(() => undefined);
  }, [ass]);

  useEffect(() => {
    draw(timeRef.current);
  }, [draw]);

  useEffect(() => {
    const inst = subs.current;
    if (inst === null || boxW === 0) return;
    void inst
      .resize(true)
      .then(() => drawRef.current(timeRef.current, true))
      .catch(() => undefined);
  }, [boxW]);

  const stop = useCallback(() => {
    vidA.current?.pause();
    vidB.current?.pause();
    setPlaying(false);
  }, []);

  // A new cut list (an edit) puts the videos back at the same short time.
  useEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => {
      stop();
      seekTo(timeRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [segs, ready, seekTo, stop]);

  // While playing: follow the active video, swap at each cut, stop at the end.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const loop = () => {
      const cur = at.current;
      const a = vid(cur.vid);
      const seg = segs[cur.seg];
      if (a === null || seg === undefined) return;
      if (a.currentTime * 1000 >= seg.srcOut - 15) {
        const next = cur.seg + 1;
        if (next >= segs.length) {
          stop();
          seekTo(0);
          return;
        }
        const other = 1 - cur.vid;
        const b = vid(other);
        if (b !== null) {
          b.playbackRate = a.playbackRate;
          void b.play().catch(() => undefined);
        }
        a.pause();
        at.current = { vid: other, seg: next };
        const after = segs[next + 1];
        if (after !== undefined) a.currentTime = after.srcIn / 1000;
      }
      const now = at.current;
      const v = vid(now.vid);
      const s2 = segs[now.seg];
      if (v !== null && s2 !== undefined) {
        const t =
          offs[now.seg]! + Math.max(0, Math.min(s2.srcOut, v.currentTime * 1000) - s2.srcIn);
        setT(t);
        drawRef.current(t);
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing, segs, offs, stop, seekTo, setT]);

  const play = useCallback(
    (rate = 1) => {
      const v = vid(at.current.vid);
      if (v === null) return;
      setPlayingKey(playKey);
      v.playbackRate = rate;
      void v.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    },
    [playKey, setPlayingKey],
  );

  useImperativeHandle(
    handle,
    () => ({
      seek: (t) => seekTo(t),
      play: (rate) => play(rate),
      pause: () => stop(),
      toggle: () => (playing ? stop() : play()),
      isPlaying: () => playing,
      activeVideo: () => vid(at.current.vid),
    }),
    [seekTo, play, stop, playing],
  );

  // Another player started: this one stops.
  useEffect(
    () =>
      usePlaying.subscribe((s) => {
        if (s.key !== playKey) stop();
      }),
    [playKey, stop],
  );

  if (src === null) {
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
        src={src}
        preload="auto"
        playsInline
        className="absolute top-0 left-0 max-w-none origin-top-left"
        onLoadedData={() => {
          if (ready) return;
          setReady(true);
          seekTo(timeRef.current);
        }}
      />
      <video
        ref={vidB}
        src={src}
        preload="auto"
        playsInline
        className="invisible absolute top-0 left-0 max-w-none origin-top-left"
      />
      <canvas
        ref={canvas}
        data-testid="player-captions"
        className="pointer-events-none absolute inset-0 size-full"
      />
      {overlay}
      {!bare && (
        <button
          type="button"
          data-testid="player-toggle"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => (playing ? stop() : play())}
          data-playing={playing}
          className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/50 via-transparent to-transparent p-2.5 text-left opacity-100 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-unread focus-visible:ring-inset data-[playing=true]:opacity-0"
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
            {fmtTime(time)} / {fmtTime(total)}
          </span>
        </button>
      )}
    </div>
  );
}
