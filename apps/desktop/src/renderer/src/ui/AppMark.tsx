// The Alcyo mark: a pointed A whose counter is Alcyone's four-point star, on
// a blue tile. Same drawing as apps/desktop/build/icon.svg. The A and star
// are one even-odd path, so the star is a true cut-out at every size.
import { useId } from "react";

/** The A with the star cut out of it, on the 1024 canvas. */
export const MARK_PATH =
  "M512 196 254 772h140l40-96h156l40 96h140Z" +
  "M512 396c8 56 34 82 90 90-56 8-82 34-90 90-8-56-34-82-90-90 56-8 82-34 90-90Z";

/** The app icon: the mark on its tile. For Home, Setup and the splash. */
export function AppMark({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="100 100 824 824"
      role="img"
      aria-label="Alcyo Shorts"
      className={className}
    >
      <defs>
        <linearGradient
          id={`${id}-tile`}
          gradientUnits="userSpaceOnUse"
          x1="200"
          y1="100"
          x2="820"
          y2="924"
        >
          <stop offset="0" stopColor="#5B8CFF" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="186" fill={`url(#${id}-tile)`} />
      <path d={MARK_PATH} fill="#FFFFFF" fillRule="evenodd" />
    </svg>
  );
}

/** The mark at small sizes next to the name: the same tile, no label. */
export function AppGlyph({ size = 18, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden className={className}>
      <defs>
        <linearGradient
          id={`${id}-tile`}
          gradientUnits="userSpaceOnUse"
          x1="200"
          y1="100"
          x2="820"
          y2="924"
        >
          <stop offset="0" stopColor="#5B8CFF" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="186" fill={`url(#${id}-tile)`} />
      <path d={size <= 24 ? SMALL_MARK_PATH : MARK_PATH} fill="#FFFFFF" fillRule="evenodd" />
    </svg>
  );
}

/** At 24 px and below the star shrinks to 65%, so the A keeps its shoulders. */
const SMALL_MARK_PATH =
  "M512 210 254 772h140l40-96h156l40 96h140Z" +
  "M512 420c5 40 24 59 66 66-42 7-61 26-66 66-5-40-24-59-66-66 42-7 61-26 66-66Z";
