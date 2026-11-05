// Sidebar (plan section 4): a 52 px top bar with the
// traffic lights and the name, a search row with New stream, the stream
// rows, and a footer with Settings and the render queue.
import type { StreamSummary } from "@alcyo/ipc";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { isMac, useUi } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { openIssues, useSetup } from "../setup/store";
import { useRenders } from "../streams/renders";
import { useStreams } from "../streams/store";
import { AppGlyph } from "../ui/AppMark";
import { CloseIcon, PenSquareIcon, SearchIcon, SettingsIcon, TrayIcon } from "../ui/icons";

const mod = isMac ? "⌘" : "Ctrl+";

/** 2m, 18h, 3d, 5w. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : `${Math.round(d / 7)}w`;
}

/** Two letters for the monogram: "Boss Fight Stream" -> "BF". */
function initials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const two = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? "S").slice(0, 2);
  return two.toUpperCase();
}

// 28 px square icon buttons, the sidebar's one button size.
const iconBtn =
  "no-drag grid size-8 shrink-0 place-items-center rounded-md text-secondary outline-none transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-white/[0.08] aria-pressed:text-text";

function StreamRow({ stream, active }: { stream: StreamSummary; active: boolean }) {
  return (
    <Link
      to="/s/$streamId"
      params={{ streamId: stream.streamId }}
      data-testid="stream-row"
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2.5 rounded-md px-2 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
        active ? "bg-white/[0.09]" : "hover:bg-white/[0.06]"
      }`}
    >
      {stream.thumbnail !== null && !stream.missing ? (
        <img
          alt=""
          data-testid="stream-thumb"
          src={`alcyo-media://thumb/${stream.streamId}`}
          className="size-8 shrink-0 rounded-md object-cover ring-1 ring-white/[0.08]"
        />
      ) : (
        <span
          aria-hidden
          className={`grid size-8 shrink-0 place-items-center rounded-md text-[10px] font-semibold tracking-wide ring-1 ring-inset ring-white/[0.06] ${
            active ? "bg-accent/15 text-accent-soft" : "bg-white/[0.05] text-secondary"
          }`}
        >
          {initials(stream.name)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[13px] leading-[18px] ${
              stream.unread || active ? "font-medium text-text" : "text-[#d4d4d4]"
            }`}
          >
            {stream.name}
          </span>
          <span className="shrink-0 text-[11px] text-tertiary tabular-nums">
            {ago(stream.lastActivityAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-tertiary">
            {stream.missing ? "Folder moved" : stream.preview || "New stream"}
          </span>
          {stream.unread && (
            <span data-testid="unread-dot" className="size-1.5 shrink-0 rounded-full bg-unread">
              <span className="sr-only">New activity</span>
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

function SearchField() {
  const { searchOpen, query, setQuery, setSearch } = useUi();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) input.current?.focus();
  }, [searchOpen]);
  useEscape("overlay", searchOpen, () => setSearch(false));

  const box =
    "no-drag flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[13px] outline-none transition-colors";
  if (!searchOpen) {
    return (
      <button
        type="button"
        data-testid="search-button"
        onClick={() => setSearch(true)}
        className={`${box} text-tertiary hover:bg-white/[0.06] hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent`}
      >
        <SearchIcon size={14} className="shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <span className="text-[11px] text-[#525252]">{mod}F</span>
      </button>
    );
  }
  return (
    <div data-overlay className={`${box} bg-white/[0.06] ring-1 ring-accent/50`}>
      <SearchIcon size={16} className="shrink-0 text-secondary" />
      <input
        ref={input}
        data-testid="search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search streams"
        aria-label="Search streams"
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-tertiary"
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={() => setSearch(false)}
        className="grid size-5 place-items-center rounded text-tertiary outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-unread"
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

export function Sidebar() {
  const router = useRouter();
  const pathname = useLocation({ select: (l) => l.pathname });
  const { searchOpen, query, focusComposer } = useUi();
  const report = useSetup((s) => s.report);
  const issues = report === null ? 0 : openIssues(report);
  const renders = useRenders((s) => s.byId);
  const rendering = Object.values(renders).filter(
    (r) => r.state === "queued" || r.state === "running",
  ).length;

  const newStream = () => {
    if (pathname !== "/") void router.navigate({ to: "/" });
    focusComposer();
  };
  const onRenders = pathname === "/renders";
  const streams = useStreams((s) => s.streams);
  const loaded = useStreams((s) => s.loaded);
  const matches = streams.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
  const activeId = /^\/s\/([^/]+)/.exec(pathname)?.[1];

  return (
    <aside
      data-testid="sidebar"
      className="flex w-[256px] shrink-0 flex-col border-r border-hairline bg-sidebar"
    >
      {/* The traffic lights, then the name, all one drag region. */}
      <div
        className={`drag flex h-[52px] shrink-0 items-center pr-3 ${isMac ? "pl-[78px]" : "pl-4"}`}
      >
        <Link
          to="/"
          data-testid="brand"
          className="no-drag flex min-w-0 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <AppGlyph size={16} />
          <span className="truncate text-[13px] leading-none font-semibold tracking-[-0.01em]">
            Alcyo <span className="font-medium text-tertiary">Shorts</span>
          </span>
        </Link>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-2 pb-2">
        <SearchField />
        <button
          type="button"
          data-testid="new-stream"
          aria-label="New stream"
          title={`New stream (${mod}N)`}
          onClick={newStream}
          className={iconBtn}
        >
          <PenSquareIcon size={15} />
        </button>
      </div>

      <div className="flex h-8 shrink-0 items-center px-4 text-[12px] font-medium text-tertiary">
        Streams
        {streams.length > 0 && (
          <span className="ml-1.5 text-[11px] text-[#525252] tabular-nums">{streams.length}</span>
        )}
      </div>
      <nav aria-label="Streams" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {searchOpen && query.length > 0 && matches.length === 0 ? (
          <p data-testid="no-matches" className="px-2 py-2 text-[13px] text-tertiary">
            No streams match “{query}”.
          </p>
        ) : streams.length === 0 ? (
          loaded && (
            <div data-testid="empty-streams" className="px-2 py-1">
              <p className="text-[13px] text-secondary">No streams yet</p>
              <p className="mt-0.5 text-[12px] leading-snug text-tertiary">
                Paste a link or choose a recording to start one.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-0.5">
            {matches.map((s) => (
              <StreamRow key={s.streamId} stream={s} active={s.streamId === activeId} />
            ))}
          </div>
        )}
      </nav>

      <footer className="flex shrink-0 flex-col px-2 pt-1 pb-2">
        {/* Compact icon buttons in one row. */}
        <div className="flex items-center gap-0.5">
          <Link
            to="/settings"
            data-testid="settings-row"
            aria-label="Settings"
            title={`Settings (${mod},)`}
            className={iconBtn}
          >
            <SettingsIcon size={16} />
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
            className={`${iconBtn} relative`}
          >
            <TrayIcon size={16} />
            {rendering > 0 && (
              <span
                data-testid="rendering-count"
                className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white tabular-nums ring-2 ring-sidebar"
              >
                {rendering}
              </span>
            )}
          </button>
          {report !== null && !report.complete && (
            <Link
              to="/setup"
              data-testid="setup-row"
              title={`${issues} setup ${issues === 1 ? "issue" : "issues"}`}
              className="no-drag ml-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-[12px] text-secondary outline-none transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-warn" />
              <span className="min-w-0 flex-1 truncate">Finish setup</span>
              <span className="text-[11px] text-tertiary tabular-nums">{issues}</span>
            </Link>
          )}
        </div>
      </footer>
    </aside>
  );
}
