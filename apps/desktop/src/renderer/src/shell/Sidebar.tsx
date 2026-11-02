// Sidebar (plan section 4): search and +, the creator header, the stream list,
// and the settings row and render queue button pinned at the bottom.
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { isMac, useUi } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { openIssues, useSetup } from "../setup/store";
import { AppMark } from "../ui/AppMark";
import { Button, IconButton, iconButtonClass } from "../ui/Button";
import { CloseIcon, GridIcon, PlusIcon, SearchIcon, SettingsIcon } from "../ui/icons";
import { Kbd } from "../ui/parts";

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

function EmptyStreams({ onNew }: { onNew: () => void }) {
  return (
    <div data-testid="empty-streams" className="mx-2 mt-2 rounded-[20px] px-5 py-8 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-bubble-claude ring-1 ring-hairline">
        <PlusIcon size={20} className="text-secondary" />
      </div>
      <p className="mt-4 text-small font-medium">No streams yet</p>
      <p className="mt-1 text-[14px] leading-snug text-secondary">
        Paste a stream link or drop in a recording. Each stream becomes a conversation here.
      </p>
      <Button size="sm" variant="secondary" className="mt-4" onClick={onNew}>
        <PlusIcon size={15} />
        New stream
      </Button>
    </div>
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
  const inSettings = pathname.startsWith("/settings");
  const matches = streams.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <aside
      data-testid="sidebar"
      className="flex w-[340px] shrink-0 flex-col border-r border-hairline bg-sidebar"
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

      <Link
        to="/settings/profile"
        data-testid="creator-header"
        className="mx-3 mt-2 flex flex-col items-center gap-2 rounded-[20px] px-4 py-4 outline-none transition-colors hover:bg-bubble-claude focus-visible:ring-2 focus-visible:ring-unread"
      >
        <AppMark size={52} className="drop-shadow-[0_6px_18px_rgba(79,107,245,0.35)]" />
        <div className="text-center">
          <div className="text-small font-semibold">Alcyo Shorts</div>
          <div className="text-[13px] text-secondary">No creator profile yet</div>
        </div>
      </Link>

      <nav aria-label="Streams" className="mt-2 flex-1 overflow-y-auto px-2">
        {searchOpen && query.length > 0 && matches.length === 0 ? (
          <p data-testid="no-matches" className="px-4 py-8 text-center text-[14px] text-secondary">
            No streams match “{query}”.
          </p>
        ) : streams.length === 0 ? (
          <EmptyStreams onNew={newStream} />
        ) : null}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-hairline p-2">
        {report !== null && !report.complete && (
          <Link
            to="/setup"
            data-testid="setup-row"
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 outline-none transition-colors hover:bg-bubble-claude focus-visible:ring-2 focus-visible:ring-unread active:bg-bubble-user"
          >
            <span className="grid size-8 place-items-center rounded-full bg-warn/15">
              <span className="size-2 rounded-full bg-warn" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-small">Finish setup</span>
              <span className="block text-[13px] text-secondary">
                {issues} {issues === 1 ? "check needs" : "checks need"} attention
              </span>
            </span>
          </Link>
        )}
        <div className="flex items-center gap-1">
          <Link
            to="/settings"
            data-testid="settings-row"
            aria-current={inSettings ? "page" : undefined}
            className={`flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 outline-none transition-colors hover:bg-bubble-claude focus-visible:ring-2 focus-visible:ring-unread active:bg-bubble-user ${inSettings ? "bg-bubble-claude" : ""}`}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bubble-user text-text ring-1 ring-hairline">
              <SettingsIcon size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-small">Settings</span>
              <span className="block truncate text-[13px] text-secondary">
                Profile, Claude, models, storage
              </span>
            </span>
            <span className="hidden xl:inline">
              <Kbd>{isMac ? "⌘," : "Ctrl+,"}</Kbd>
            </span>
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
            <GridIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
