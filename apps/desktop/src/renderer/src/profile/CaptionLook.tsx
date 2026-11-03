// A small 9:16 preview of a caption look. The real captions come from the
// .ass builder in spec 9; this shows color, outline, case and position so the
// creator can pick one. Bundled fonts arrive with spec 9, so the system font
// stands in when the named font isn't installed.
import type { CaptionPreset, HookPreset } from "@alcyo/schema";

const SAMPLE = ["he", "did", "not", "see", "that"];
const BOX_H = 220;

function outline(px: number, color: string, shadow: number): string {
  const shadows = [];
  if (px > 0) {
    const r = Math.max(1, Math.round(px));
    for (const [x, y] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
      [r, r],
      [-r, -r],
      [r, -r],
      [-r, r],
    ])
      shadows.push(`${x}px ${y}px 0 ${color}`);
  }
  if (shadow > 0) shadows.push(`0 ${shadow}px ${shadow * 2}px rgba(0,0,0,0.7)`);
  return shadows.join(", ") || "none";
}

export function CaptionLook({
  caption,
  hook,
  selected,
  onPick,
  testId,
}: {
  caption: CaptionPreset;
  hook: HookPreset | undefined;
  selected?: boolean;
  onPick?: () => void;
  testId?: string;
}) {
  const scale = BOX_H / 1920;
  const words = SAMPLE.slice(0, Math.max(1, Math.min(caption.wordsPerLine, SAMPLE.length)));
  const fontFamily = `"${caption.font}", system-ui, sans-serif`;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected === true}
      aria-label={`${caption.name} caption look`}
      onClick={onPick}
      className={`group flex flex-col items-center gap-2 rounded-2xl p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-unread ${
        selected === true ? "bg-bubble-user ring-1 ring-unread" : "hover:bg-bubble-claude"
      }`}
    >
      <div
        className="relative overflow-hidden rounded-xl bg-gradient-to-b from-[#2b3a55] via-[#1d2433] to-[#131313]"
        style={{ height: BOX_H, width: (BOX_H * 9) / 16 }}
      >
        {hook !== undefined && (
          <span
            className="absolute inset-x-2 text-center font-black leading-tight"
            style={{
              top: `${hook.positionY * 100}%`,
              transform: "translateY(-50%)",
              fontFamily: `"${hook.font}", system-ui, sans-serif`,
              fontSize: Math.max(8, hook.sizePx * scale),
              color: hook.color,
              textTransform: hook.uppercase ? "uppercase" : "none",
            }}
          >
            <span
              style={{
                background: hook.background ?? "transparent",
                padding: hook.background === null ? 0 : "1px 4px",
                borderRadius: 3,
                textShadow: hook.background === null ? outline(1, "#000", 0) : "none",
              }}
            >
              No way
            </span>
          </span>
        )}
        <span
          className="absolute inset-x-1 text-center leading-tight"
          style={{
            top: `${caption.positionY * 100}%`,
            transform: "translateY(-50%)",
            fontFamily,
            fontWeight: 800,
            fontSize: Math.max(9, caption.sizePx * scale),
            color: caption.color,
            textTransform: caption.uppercase ? "uppercase" : "none",
            textShadow: outline(
              caption.outlinePx * scale,
              caption.outlineColor,
              caption.shadowPx * scale,
            ),
          }}
        >
          {words.map((w, i) => (
            <span key={w} style={{ color: i === 1 ? caption.highlightColor : undefined }}>
              {i > 0 ? " " : ""}
              {w}
            </span>
          ))}
        </span>
      </div>
      <span className="text-[14px] text-secondary group-hover:text-text">{caption.name}</span>
    </button>
  );
}
