// Small shared pieces: status icons, cards, rows, copy buttons, chips.
import type { CheckState } from "@alcyo/ipc";
import type { ReactNode } from "react";
import { AlertIcon, CheckIcon, ClockIcon, CopyIcon } from "./icons";
import { toast } from "./toast";

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="spin inline-block shrink-0 rounded-full border-2 border-secondary/30 border-t-text"
      style={{ width: size, height: size }}
    />
  );
}

const stateStyle: Record<CheckState, string> = {
  pass: "bg-ok/12 text-ok",
  fail: "bg-bad/12 text-bad",
  pending: "bg-warn/12 text-warn",
};
const stateLabel: Record<CheckState, string> = {
  pass: "Ready",
  fail: "Needs a fix",
  pending: "Waiting",
};

export function StateIcon({ state, size = 28 }: { state: CheckState; size?: number }) {
  const Icon = state === "pass" ? CheckIcon : state === "fail" ? AlertIcon : ClockIcon;
  return (
    <span
      role="img"
      aria-label={stateLabel[state]}
      className={`grid shrink-0 place-items-center rounded-full ${stateStyle[state]}`}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.58)} strokeWidth={2.2} />
    </span>
  );
}

export function StateBadge({ state, children }: { state: CheckState; children?: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-medium ${stateStyle[state]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children ?? stateLabel[state]}
    </span>
  );
}

/** A quiet "Soon" tag for things not built yet. The spec number is in the tooltip. */
export function ComesIn({ spec }: { spec: number }) {
  return (
    <span
      data-testid="comes-in"
      title={`Comes in spec ${spec}`}
      className="inline-flex shrink-0 items-center rounded-full bg-bubble-user px-2 py-0.5 text-[12px] whitespace-nowrap text-tertiary"
    >
      Soon
    </span>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  testId,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="overflow-hidden rounded-xl bg-card/60 ring-1 ring-hairline"
      aria-label={title}
    >
      <div className="flex items-center gap-4 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold">{title}</h3>
          {description !== undefined && (
            <p className="mt-0.5 text-[13px] leading-snug text-tertiary">{description}</p>
          )}
        </div>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children !== undefined && <div className="border-t border-hairline">{children}</div>}
    </section>
  );
}

export function Row({
  label,
  children,
  mono = false,
  aside,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  aside?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-4 border-b border-hairline px-4 py-2.5 last:border-b-0">
      <div className="w-40 shrink-0 text-[14px] text-secondary">{label}</div>
      <div
        className={`min-w-0 flex-1 text-[14px] break-words select-text ${mono ? "font-mono text-[13px]" : ""}`}
      >
        {children}
      </div>
      {aside !== undefined && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The window denies permission prompts; fall back to a selection copy.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(text).then((ok) =>
          ok ? toast("Copied", text.length > 80 ? undefined : text) : toast("Couldn't copy that"),
        );
      }}
      aria-label={`${label}: ${text}`}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-full text-secondary outline-none transition-colors hover:bg-bubble-user hover:text-text focus-visible:ring-2 focus-visible:ring-unread active:scale-95"
    >
      <CopyIcon size={15} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md bg-bubble-user px-1.5 py-0.5 font-sans text-[12px] text-secondary ring-1 ring-hairline">
      {children}
    </kbd>
  );
}
