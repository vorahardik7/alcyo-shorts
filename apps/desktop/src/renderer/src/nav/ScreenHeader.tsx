// The header on every non-thread screen: Back, the screen's name, actions.
import type { ReactNode } from "react";
import { BackIcon } from "../ui/icons";
import { isMac, useBack } from "./navigation";

export function ScreenHeader({
  title,
  subtitle,
  actions,
  fullWindow = false,
  backLabel = "Back",
  onBack,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** True when no sidebar sits to the left, so the macOS traffic lights do. */
  fullWindow?: boolean;
  backLabel?: string;
  onBack?: () => void;
}) {
  const back = useBack();
  return (
    <header
      className={`drag flex h-16 shrink-0 items-center gap-3 border-b border-hairline pr-5 ${
        fullWindow && isMac ? "pl-[88px]" : "pl-4"
      }`}
    >
      <button
        type="button"
        data-testid="back"
        onClick={onBack ?? back}
        title={`${backLabel} (${isMac ? "⌘[" : "Alt+←"})`}
        className="no-drag inline-flex h-9 items-center gap-1 rounded-full pr-3.5 pl-2 text-small text-secondary outline-none transition-colors hover:bg-bubble-claude hover:text-text focus-visible:ring-2 focus-visible:ring-unread active:bg-bubble-user"
      >
        <BackIcon size={18} />
        {backLabel}
      </button>
      <div className="min-w-0 flex-1">
        <h1 data-testid="screen-title" className="truncate text-[17px] font-semibold">
          {title}
        </h1>
        {subtitle !== undefined && (
          <p className="truncate text-[13px] text-secondary">{subtitle}</p>
        )}
      </div>
      {actions !== undefined && <div className="no-drag flex items-center gap-2">{actions}</div>}
    </header>
  );
}
