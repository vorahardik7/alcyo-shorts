import { Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { inSettings, useNavShortcuts } from "../nav/navigation";
import { useSetup } from "../setup/store";
import { AppMark } from "../ui/AppMark";
import { UploadIcon } from "../ui/icons";
import { Spinner } from "../ui/parts";
import { Toaster } from "../ui/toast";
import { watchProfile } from "../profile/store";
import { plainError } from "../streams/store";
import { toast } from "../ui/toast";
import { Sidebar } from "./Sidebar";
import { watchRenders } from "../streams/renders";
import { watchStreams } from "../streams/store";
import { useLinks } from "./useLinks";

const SLOW_CHECK_MS = 6000;

function Splash() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_CHECK_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      data-testid="splash"
      className="drag flex h-full flex-col items-center justify-center gap-5"
    >
      <AppMark size={72} className="drop-shadow-[0_10px_30px_rgba(79,107,245,0.35)]" />
      <div className="flex items-center gap-2 text-small text-secondary">
        <Spinner size={14} />
        {slow
          ? "Still checking. The first check after an install takes longer."
          : "Checking your setup…"}
      </div>
    </div>
  );
}

/** Shows a drop target while files are dragged over the window. */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") === true;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    // Always cancel these, so a dropped file never navigates the window.
    const overFn = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = hasFiles(e) ? "copy" : "none";
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      // The preload hands the paths to main, which answers with drop:files.
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return over;
}

/**
 * On launch, waits for the first setup report. If setup isn't complete and the
 * app opened on home, it opens Setup instead.
 */
function useStartupGate(): boolean {
  const router = useRouter();
  const { report, error, skipped, load } = useSetup();
  const gated = useRef(false);
  const ready = report !== null || error !== null;
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (gated.current || !ready) return;
    gated.current = true;
    if (report !== null && !report.complete && !skipped) {
      if (router.state.location.pathname === "/") {
        void router.navigate({ to: "/setup", replace: true });
      }
    }
  }, [ready, report, skipped, router]);
  return ready;
}

/** Files dropped on the window: main holds the paths; we say which stream they go to. */
function useDroppedFiles(): void {
  const router = useRouter();
  useEffect(
    () =>
      window.alcyo.on("drop:files", ({ token, names }) => {
        const streamId = /^\/s\/([^/]+)/.exec(router.state.location.pathname)?.[1];
        toast(
          names.length === 1 ? `Adding ${names[0]}` : `Adding ${names.length} files`,
          "It stays where it is; nothing is copied or uploaded.",
        );
        window.alcyo
          .invoke("drop:use", { token, ...(streamId === undefined ? {} : { streamId }) })
          .then(
            (out) => {
              if ("failed" in out) toast("Couldn't add that", out.message);
              else if (out.streamId !== streamId) {
                void router.navigate({ to: "/s/$streamId", params: { streamId: out.streamId } });
              }
            },
            (error: unknown) => toast("Couldn't add that", plainError(error)),
          );
      }),
    [router],
  );
}

export function Layout() {
  const { notice, dismiss } = useLinks();
  useNavShortcuts();
  const ready = useStartupGate();
  const dropping = useFileDrop();
  useDroppedFiles();
  useEffect(() => watchStreams(), []);
  useEffect(() => watchProfile(), []);
  useEffect(() => watchRenders(), []);
  const pathname = useLocation({ select: (l) => l.pathname });
  // Setup and Settings take the whole window; Settings brings its own nav.
  const fullWindow = pathname === "/setup" || inSettings(pathname);

  if (!ready) return <Splash />;

  return (
    <div className="flex h-full bg-bg text-text">
      {!fullWindow && <Sidebar />}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {notice !== null && (
          <div
            role="alert"
            data-testid="link-notice"
            className="toast-in no-drag absolute top-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-bubble bg-bubble-claude px-5 py-3 text-small shadow-lg ring-1 ring-hairline"
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full px-2 text-secondary outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-unread"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        <Outlet />
        {dropping && (
          <div
            data-testid="drop-target"
            className="fade-in pointer-events-none absolute inset-4 z-50 flex flex-col items-center justify-center rounded-[28px] border-2 border-dashed border-unread/70 bg-[#0b0b0bf0] text-center backdrop-blur-md"
          >
            <span className="grid size-14 place-items-center rounded-2xl bg-unread/15 text-unread">
              <UploadIcon size={26} />
            </span>
            <p className="mt-4 text-body font-medium">Drop to start a new stream</p>
            <p className="mt-1 text-small text-secondary">
              A recording or a viewer clip. Files stay where they are.
            </p>
          </div>
        )}
      </main>
      <Toaster />
    </div>
  );
}
