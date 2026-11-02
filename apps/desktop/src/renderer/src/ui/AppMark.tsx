// The Alcyo mark: a 9:16 frame with a four-point star (Alcyone, the brightest
// of the Pleiades). Same drawing as apps/desktop/build/icon.svg.
import { useId } from "react";

export function AppMark({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="Alcyo Shorts"
      className={className}
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B8CFF" />
          <stop offset="0.55" stopColor="#4F6BF5" />
          <stop offset="1" stopColor="#2448C9" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.3" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1024" height="1024" rx="232" fill={`url(#${id}-bg)`} />
      <rect width="1024" height="1024" rx="232" fill={`url(#${id}-glow)`} />
      <rect
        x="347"
        y="214"
        width="330"
        height="596"
        rx="64"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.92"
        strokeWidth="44"
      />
      <path
        d="M512 402c10 68 42 100 110 110-68 10-100 42-110 110-10-68-42-100-110-110 68-10 100-42 110-110Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
