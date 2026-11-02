// The Back button on screens outside the chat (Settings, Setup).
import { BackIcon } from "../ui/icons";
import { isMac, useBack } from "./navigation";

export function BackButton({ label = "Back", onBack }: { label?: string; onBack?: () => void }) {
  const back = useBack();
  return (
    <button
      type="button"
      data-testid="back"
      onClick={onBack ?? back}
      title={`${label} (${isMac ? "⌘[" : "Alt+←"}, Esc)`}
      className="no-drag inline-flex h-8 items-center gap-1 rounded-full pr-3 pl-1.5 text-[14px] text-secondary outline-none transition-colors hover:bg-bubble-claude hover:text-text focus-visible:ring-2 focus-visible:ring-unread active:bg-bubble-user"
    >
      <BackIcon size={17} />
      {label}
    </button>
  );
}
