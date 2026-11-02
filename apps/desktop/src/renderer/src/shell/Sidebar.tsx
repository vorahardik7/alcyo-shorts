// Sidebar (plan section 4): search and +, the stream list, and Settings and the
// render queue pinned at the bottom. The creator header joins it with profiles
// (spec 7).
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { isMac, useUi } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { openIssues, useSetup } from "../setup/store";
import { IconButton, iconButtonClass } from "../ui/Button";
import { CloseIcon, GridIcon, PlusIcon, SearchIcon, SettingsIcon } from "../ui/icons";

/** Streams arrive with the project store (spec 4); until then the list is empty. */
const streams: Array<{ id: string; name: string; preview: string }> = [];

function SearchBox() {
  const { query, setQuery, setSearch } = useUi();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEscape("overlay", true, () => setSearch(false));
  return (
    <div
      data-overlay
      className="no-drag flex h-9 flex-1 items-center gap-2 rounded-full bg-bubble-claude pr-1 pl-3 ring-1 ring-hairline focus-within:ring-unread/70"
    >
      <SearchIcon size={16} className="shrink-0 text-secondary" />
      <input
        ref={input}
        data-testid="search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search streams"
        aria-label="Search streams"
        className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-tertiary"
      />
      <IconButton label="Close search" size="sm" onClick={() => setSearch(false)}>
        <CloseIcon size={14} />
      </IconButton>
    </div>
  );
}

function EmptyStreams() {
  return (
    <p data-testid="empty-streams" className="px-3 py-2 text-[14px] text-tertiary">
      No streams yet
    </p>
  );
}

export function Sidebar() {
  const router = useRouter();
  const pathname = useLocation({ select: (l) => l.pathname });
  const { searchOpen, query, setSearch, focusComposer } = useUi();
  const report = useSetup((s) => s.report);
  const issues = report === null ? 0 : openIssues(report);

  const newStream = () => {
    if (pathname !== "/") void router.navigate({ to: "/" });
    focusComposer();
  };
  const onRenders = pathname === "/renders";
  const matches = streams.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <aside
      data-testid="sidebar"
      className="flex w-[280px] shrink-0 flex-col border-r border-hairline bg-sidebar"
    >
      {/* The macOS traffic lights sit in the top-left corner. */}
      <div
        className={`drag flex h-[52px] shrink-0 items-center gap-1 pr-3 ${isMac ? "pl-[84px]" : "pl-3"}`}
      >
        {searchOpen ? (
          <SearchBox />
        ) : (
          <>
            <div className="flex-1" />
            <IconButton
              label={`Search (${isMac ? "⌘" : "Ctrl+"}F)`}
              data-testid="search-button"
              onClick={() => setSearch(true)}
            >
              <SearchIcon />
            </IconButton>
          </>
        )}
        <IconButton label="New stream" data-testid="new-stream" onClick={newStream}>
          <PlusIcon />
        </IconButton>
      </div>

      <nav aria-label="Streams" className="mt-1 flex-1 overflow-y-auto px-2">
        {searchOpen && query.length > 0 && matches.length === 0 ? (
          <p data-testid="no-matches" className="px-3 py-2 text-[14px] text-tertiary">
            No streams match “{query}”.
          </p>
        ) : streams.length === 0 ? (
          <EmptyStreams />
        ) : null}
      </nav>

      <div className="shrink-0 space-y-1 p-2">
        {report !== null && !report.complete && (
          <Link
            to="/setup"
            data-testid="setup-row"
            className="flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] outline-none transition-colors hover:bg-bubble-claude focus-visible:ring-2 focus-visible:ring-unread"
          >
            <span className="size-2 shrink-0 rounded-full bg-warn" />
            <span className="min-w-0 flex-1 truncate">Finish setup</span>
            <span className="text-[13px] text-tertiary">
              {issues} {issues === 1 ? "issue" : "issues"}
            </span>
          </Link>
        )}
        <div className="flex items-center gap-1">
          <Link
            to="/settings"
            data-testid="settings-row"
            title={`Settings (${isMac ? "⌘," : "Ctrl+,"})`}
            className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 text-[15px] text-secondary outline-none transition-colors hover:bg-bubble-claude hover:text-text focus-visible:ring-2 focus-visible:ring-unread"
          >
            <SettingsIcon size={18} />
            Settings
          </Link>
          <button
            type="button"
            data-testid="render-queue-button"
            aria-label="Render queue"
            title="Render queue"
            aria-pressed={onRenders}
            onClick={() => {
              if (!onRenders) void router.navigate({ to: "/renders" });
              else if (router.history.canGoBack()) router.history.back();
              else void router.navigate({ to: "/" });
            }}
            className={iconButtonClass("md", onRenders)}
          >
            <GridIcon size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
