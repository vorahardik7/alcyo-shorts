// A small 9:16 preview of a caption look. The real captions come from the
// .ass builder in spec 9; this shows color, outline, case and position so the
// creator can pick one. Bundled fonts arrive with spec 9, so the system font
// stands in when the named font isn't installed.
import type { CaptionPreset, HookPreset } from "@alcyo/schema";

const SAMPLE = ["he", "did", "not", "see", "that"];
const BOX_H = 168;

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
      className={`group flex flex-col items-center gap-2 rounded-xl border p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
        selected === true
          ? "border-accent/70 bg-accent/[0.08]"
          : "border-transparent hover:border-line hover:bg-white/[0.02]"
      }`}
    >
      <span
        className={`text-[12px] font-medium ${selected === true ? "text-text" : "text-secondary group-hover:text-text"}`}
      >
        {caption.name}
      </span>
      <div
        className="relative overflow-hidden rounded-lg bg-gradient-to-b from-[#2b3a55] via-[#1d2433] to-[#131313]"
        style={{ height: BOX_H, width: (BOX_H * 9) / 16 }}
      >
        {hook !== undefined && (
          <span
            className="absolute inset-x-2 text-center font-black leading-tight"
            style={{
              top: `${hook.positionY * 100}%`,
              transform: "translateY(-50%)",
              fontFamily: `"${hook.font}", system-ui, sans-serif`,
              fontSize: 10,
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
            fontSize: 18,
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
    </button>
  );
}
