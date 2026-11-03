// The Alcyo mark: a wide stream frame with a tall 9:16 short cut out of it and
// breaking past its edges, with Alcyone's four-point star in the cut. Same
// drawing as apps/desktop/build/icon.svg.
import { useId } from "react";

const STAR =
  "M595 362c9 62 38 91 100 100-62 9-91 38-100 100-9-62-38-91-100-100 62-9 91-38 100-100Z";

/** The app icon: the mark on its dark tile. For Setup and the splash. */
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
        <linearGradient id={`${id}-cut`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#9DB8FF" />
          <stop offset="0.5" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1E4FD8" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <rect x="100" y="100" width="824" height="824" rx="186" />
        </clipPath>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="186" fill="#141519" />
      <g clipPath={`url(#${id}-clip)`}>
        <rect
          x="196"
          y="352"
          width="632"
          height="356"
          rx="44"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.34"
          strokeWidth="22"
        />
        <rect x="452" y="236" width="286" height="508" rx="48" fill={`url(#${id}-cut)`} />
        <path d={STAR} fill="#FFFFFF" />
      </g>
      <rect
        x="101"
        y="101"
        width="822"
        height="822"
        rx="185"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.1"
        strokeWidth="3"
      />
    </svg>
  );
}

/**
 * The mark without its tile, for small sizes next to the name. The frame is
 * drawn heavier so it still reads at 16 px.
 */
export function AppGlyph({ size = 18, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="180 220 664 540" aria-hidden className={className}>
      <defs>
        <linearGradient id={`${id}-cut`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#9DB8FF" />
          <stop offset="0.55" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#2557E8" />
        </linearGradient>
      </defs>
      <rect
        x="206"
        y="362"
        width="612"
        height="336"
        rx="48"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="44"
      />
      <rect x="452" y="236" width="286" height="508" rx="56" fill={`url(#${id}-cut)`} />
      <path d={STAR} fill="#FFFFFF" />
    </svg>
  );
}
