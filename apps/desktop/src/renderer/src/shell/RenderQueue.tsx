// The render queue drawer, at /renders, over the home thread.
import { useEffect, useRef } from "react";
import { useBack, usePageTitle } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { IconButton } from "../ui/Button";
import { CloseIcon, TrayIcon } from "../ui/icons";
import { RenderStatus, useRenders } from "../streams/renders";
import { Home } from "./pages";

function Drawer() {
  usePageTitle("Render queue");
  const close = useBack();
  useEscape("overlay", true, close);
  const closeButton = useRef<HTMLButtonElement>(null);
  const byId = useRenders((s) => s.byId);
  const renders = Object.values(byId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => before?.focus?.();
  }, []);

  return (
    // Covers the thread only, so the sidebar (and its grid button) stays usable.
    <div className="absolute inset-0 z-40 flex justify-end" data-testid="render-queue">
      <div
        className="fade-in absolute inset-0 bg-black/35 backdrop-blur-[2px]"
        onClick={close}
        aria-hidden
      />
      <div
        role="dialog"
        aria-labelledby="render-queue-title"
        data-overlay
        className="drawer-in relative flex h-full w-[420px] max-w-full flex-col border-l border-line bg-surface shadow-[-16px_0_48px_rgba(0,0,0,0.4)]"
      >
        <header className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-hairline pr-2 pl-5">
          <div className="min-w-0 flex-1">
            <h2
              id="render-queue-title"
              data-testid="screen-title"
              className="text-[14px] leading-5 font-semibold"
            >
              Render queue
            </h2>
            <p className="text-[12px] leading-4 text-tertiary">1080 × 1920 MP4, one at a time</p>
          </div>
          <IconButton
            size="sm"
            ref={closeButton}
            label="Close (Esc)"
            data-testid="close-drawer"
            onClick={close}
          >
            <CloseIcon />
          </IconButton>
        </header>
        {renders.length > 0 ? (
          <ul data-testid="render-list" className="flex-1 space-y-2 overflow-y-auto p-3">
            {renders.map((r) => (
              <li
                key={r.renderId}
                data-testid="render-item"
                className="rounded-xl border border-line bg-surface px-4 py-3"
              >
                <RenderStatus r={r} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
            <div className="grid size-11 place-items-center rounded-xl border border-line bg-surface text-secondary">
              <TrayIcon size={20} />
            </div>
            <p className="mt-4 text-[15px] font-semibold">No renders yet</p>
            <p className="mt-1 text-[13px] leading-snug text-secondary">
              Press Render on a short to add it here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function RenderQueuePage() {
  return (
    <>
      <Home />
      <Drawer />
    </>
  );
}
