// Sidebar (plan section 4), laid out like T3 Code's: a 52 px top bar with the
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
import { CloseIcon, FilmIcon, PenSquareIcon, SearchIcon, SettingsIcon } from "../ui/icons";

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
  "no-drag grid size-7 shrink-0 place-items-center rounded-md text-secondary outline-none transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:ring-2 focus-visible:ring-unread aria-pressed:bg-white/[0.08] aria-pressed:text-text";

function StreamRow({ stream, active }: { stream: StreamSummary; active: boolean }) {
  return (
    <Link
      to="/s/$streamId"
      params={{ streamId: stream.streamId }}
      data-testid="stream-row"
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2.5 rounded-lg px-2 py-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-unread ${
        active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
      }`}
    >
      <span
        aria-hidden
        className={`grid size-8 shrink-0 place-items-center rounded-[9px] font-mono text-[11px] font-semibold tracking-wide ring-1 ring-inset ring-white/[0.06] ${
          active ? "bg-unread/15 text-[#9DB8FF]" : "bg-white/[0.05] text-secondary"
        }`}
      >
        {initials(stream.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[14px] leading-5 ${
              stream.unread || active ? "font-medium text-text" : "text-[#d4d4d4]"
            }`}
          >
            {stream.name}
          </span>
          <span className="shrink-0 text-[12px] text-tertiary tabular-nums">
            {ago(stream.lastActivityAt)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-tertiary">
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
    "no-drag flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-[14px] outline-none transition-colors";
  if (!searchOpen) {
    return (
      <button
        type="button"
        data-testid="search-button"
        onClick={() => setSearch(true)}
        className={`${box} text-tertiary hover:bg-white/[0.04] hover:text-secondary focus-visible:ring-2 focus-visible:ring-unread`}
      >
        <SearchIcon size={16} className="shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <span className="text-[12px] text-[#5c5c5c]">{mod}F</span>
      </button>
    );
  }
  return (
    <div data-overlay className={`${box} bg-white/[0.05] ring-1 ring-unread/50`}>
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
      className="flex w-[264px] shrink-0 flex-col border-r border-hairline bg-sidebar"
    >
      {/* The macOS traffic lights sit at x 16, y 19; the name starts after them. */}
      <div
        className={`drag flex h-[52px] shrink-0 items-center pr-2 ${isMac ? "pl-[84px]" : "pl-3"}`}
      >
        <Link
          to="/"
          data-testid="brand"
          className="no-drag flex items-center gap-2 rounded-md px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-unread"
        >
          <AppGlyph size={17} className="text-text" />
          <span className="text-[14px] leading-none font-semibold tracking-[-0.01em]">
            Alcyo <span className="font-normal text-secondary">Shorts</span>
          </span>
        </Link>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-2 pb-2">
        <SearchField />
        <button
          type="button"
          data-testid="new-stream"
          aria-label="New stream"
          title="New stream"
          onClick={newStream}
          className={iconBtn}
        >
          <PenSquareIcon size={16} />
        </button>
      </div>

      <nav aria-label="Streams" className="min-h-0 flex-1 overflow-y-auto px-2">
        {searchOpen && query.length > 0 && matches.length === 0 ? (
          <p data-testid="no-matches" className="px-2 py-2 text-[13px] text-tertiary">
            No streams match “{query}”.
          </p>
        ) : streams.length === 0 ? (
          loaded && (
            <div data-testid="empty-streams" className="px-2 py-2">
              <p className="text-[13px] text-secondary">No streams yet</p>
              <p className="mt-0.5 text-[12px] leading-snug text-tertiary">
                Paste a link or choose a recording to start one.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-px">
            {matches.map((s) => (
              <StreamRow key={s.streamId} stream={s} active={s.streamId === activeId} />
            ))}
          </div>
        )}
      </nav>

      {report !== null && !report.complete && (
        <div className="shrink-0 px-2 pt-1">
          <Link
            to="/setup"
            data-testid="setup-row"
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-text outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-unread"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-warn" />
            <span className="min-w-0 flex-1 truncate">Finish setup</span>
            <span className="text-[12px] text-tertiary tabular-nums">
              {issues} {issues === 1 ? "issue" : "issues"}
            </span>
          </Link>
        </div>
      )}

      <footer className="flex h-12 shrink-0 items-center gap-0.5 px-2">
        <Link
          to="/settings"
          data-testid="settings-row"
          aria-label="Settings"
          title={`Settings (${mod},)`}
          className={iconBtn}
        >
          <SettingsIcon size={17} />
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
          <FilmIcon size={17} />
          {rendering > 0 && (
            <span
              data-testid="rendering-count"
              className="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-unread px-1 text-[9px] font-semibold text-white tabular-nums"
            >
              {rendering}
            </span>
          )}
        </button>
      </footer>
    </aside>
  );
}
