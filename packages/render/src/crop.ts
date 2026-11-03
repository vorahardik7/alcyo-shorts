// The 9:16 window (plan section 18). One function for the preview and the
// render: cropWindow gives the window at a short time, and cropXExpr gives
// ffmpeg the same thing as an expression in t. Pure and Node-free, so the
// renderer imports it.
//
// A key's x is where the window sits in the room it can move in: 0 is the
// left edge, 1 the right, 0.5 centered. "hold" keeps x until the next key;
// "linear" moves to the next key's x. Before the first key and after the
// last, x stays put.
import type { CropKey } from "@alcyo/schema";

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const even = (n: number) => 2 * Math.floor(n / 2);

/** The largest 9:16 window that fits the source, in even pixels. */
export function cropSize(srcW: number, srcH: number): { w: number; h: number } {
  const w = Math.min(srcW, even((srcH * 9) / 16));
  const h = Math.min(srcH, even((w * 16) / 9));
  return { w: even(w), h: even(h) };
}

/** The window's position as a 0..1 fraction at short time tMs. */
export function cropFraction(keys: readonly CropKey[], tMs: number): number {
  const first = keys[0];
  if (first === undefined) return 0.5;
  if (tMs < first.t) return first.x;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const next = keys[i + 1];
    if (next === undefined || tMs < next.t) {
      if (next === undefined || k.ease === "hold") return k.x;
      return k.x + ((next.x - k.x) * (tMs - k.t)) / (next.t - k.t);
    }
  }
  return keys.at(-1)!.x;
}

/** The crop box in source pixels at short time tMs. x is even, as ffmpeg's crop rounds it. */
export function cropWindow(
  keys: readonly CropKey[],
  tMs: number,
  srcW: number,
  srcH: number,
): CropBox {
  const { w, h } = cropSize(srcW, srcH);
  const room = srcW - w;
  const x = Math.min(room, Math.max(0, even(room * cropFraction(keys, tMs))));
  return { x, y: even((srcH - h) / 2), w, h };
}

/** Terms per section of the crop expression. */
export const SECTION = 32;

const num = (v: number) => {
  const s = v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
};
const sec = (ms: number) => num(ms / 1000);

/**
 * ffmpeg's crop x for the same keys, in t (short seconds). A sum of
 * interval terms in sections of 32, not nested ifs: ffmpeg's parser stops at
 * about 100 levels of nesting, and a short can have 200 keys.
 */
export function cropXExpr(keys: readonly CropKey[], srcW: number, srcH: number): string {
  const { w } = cropSize(srcW, srcH);
  const room = srcW - w;
  if (room <= 0) return "0";
  if (keys.length === 0) return String(even(room / 2));
  const terms: string[] = [];
  const first = keys[0]!;
  if (first.t > 0) terms.push(`lt(t,${sec(first.t)})*${num(first.x)}`);
  keys.forEach((k, i) => {
    const next = keys[i + 1];
    const from = `gte(t,${sec(k.t)})`;
    if (next === undefined) {
      terms.push(`${from}*${num(k.x)}`);
      return;
    }
    const inside = `${from}*lt(t,${sec(next.t)})`;
    if (k.ease === "hold" || next.x === k.x) {
      terms.push(`${inside}*${num(k.x)}`);
    } else {
      const slope = num((next.x - k.x) / ((next.t - k.t) / 1000));
      terms.push(`${inside}*(${num(k.x)}+${slope}*(t-${sec(k.t)}))`);
    }
  });
  // Sections of 32 terms, so no one sum runs long (ffmpeg notes).
  const sections: string[] = [];
  for (let i = 0; i < terms.length; i += SECTION) {
    sections.push(`(${terms.slice(i, i + SECTION).join("+")})`);
  }
  return `clip(2*floor(${room}*(${sections.join("+")})/2),0,${room})`;
}
