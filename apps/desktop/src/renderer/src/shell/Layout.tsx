import { Outlet } from "@tanstack/react-router";
import { Sidebar } from "./Sidebar";
import { useLinks } from "./useLinks";

export function Layout() {
  const { notice, dismiss } = useLinks();
  return (
    <div className="flex h-full bg-bg text-text">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="drag absolute inset-x-0 top-0 h-10" aria-hidden />
        {notice !== null && (
          <div
            role="alert"
            data-testid="link-notice"
            className="no-drag absolute left-1/2 top-16 z-10 flex -translate-x-1/2 items-center gap-4 rounded-bubble bg-bubble-claude px-5 py-3 text-small shadow-lg ring-1 ring-hairline"
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full px-2 text-secondary hover:text-text"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
