import { Link } from "@tanstack/react-router";

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="no-drag grid size-9 place-items-center rounded-full text-secondary hover:bg-bubble-claude hover:text-text"
    >
      {children}
    </button>
  );
}

export function Sidebar() {
  return (
    <aside
      data-testid="sidebar"
      className="flex w-[340px] shrink-0 flex-col border-r border-hairline bg-sidebar"
    >
      {/* Leaves room for the macOS traffic lights. */}
      <div className="drag flex h-14 items-center justify-end gap-1 px-3 pt-2">
        <IconButton label="Search">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </IconButton>
        <IconButton label="New stream">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </IconButton>
      </div>

      <div className="flex flex-col items-center gap-2 px-4 pb-4">
        <div className="grid size-12 place-items-center rounded-full bg-bubble-user text-small text-secondary">
          A
        </div>
        <div className="text-small text-secondary">Alcyo Shorts</div>
      </div>

      <nav aria-label="Streams" className="flex-1 overflow-y-auto px-2">
        <p data-testid="empty-streams" className="px-3 py-6 text-center text-small text-secondary">
          No streams yet
        </p>
      </nav>

      <div className="flex items-center justify-between border-t border-hairline px-3 py-3">
        <Link
          to="/settings/profile"
          className="flex items-center gap-3 rounded-full px-2 py-1 text-small hover:bg-bubble-claude"
        >
          <span className="grid size-8 place-items-center rounded-full bg-bubble-user text-secondary">
            ?
          </span>
          <span>Profile and settings</span>
        </Link>
        <Link
          to="/renders"
          aria-label="Render queue"
          title="Render queue"
          className="grid size-9 place-items-center rounded-full text-secondary hover:bg-bubble-claude hover:text-text"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="4" y="4" width="6" height="6" rx="1.5" />
            <rect x="14" y="4" width="6" height="6" rx="1.5" />
            <rect x="4" y="14" width="6" height="6" rx="1.5" />
            <rect x="14" y="14" width="6" height="6" rx="1.5" />
          </svg>
        </Link>
      </div>
    </aside>
  );
}
