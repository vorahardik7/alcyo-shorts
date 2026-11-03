// Renders in the window (plan section 4): the render card in a thread, and a
// store the queue drawer and cards share. Main owns the queue; this listens.
import type { RenderView } from "@alcyo/ipc";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { Button } from "../ui/Button";
import { AlertIcon, CheckIcon, FilmIcon } from "../ui/icons";
import { CopyButton, Spinner } from "../ui/parts";
import { toast } from "../ui/toast";
import { plainError } from "./store";

interface RendersStore {
  byId: Record<string, RenderView>;
  load: () => Promise<void>;
  put: (r: RenderView) => void;
}

export const useRenders = create<RendersStore>((set) => ({
  byId: {},
  load: async () => {
    const list = await window.alcyo.invoke("render:list", {}).catch(() => []);
    set((s) => ({ byId: { ...s.byId, ...Object.fromEntries(list.map((r) => [r.renderId, r])) } }));
  },
  put: (r) => set((s) => ({ byId: { ...s.byId, [r.renderId]: r } })),
}));

/** Keeps render state fresh. Call once, from the layout. */
export function watchRenders(): () => void {
  void useRenders.getState().load();
  return window.alcyo.on("render:changed", ({ render }) => useRenders.getState().put(render));
}

export function startRender(streamId: string, shortId: string, version: number): void {
  window.alcyo
    .invoke("render:enqueue", { streamId, shortId, version })
    .catch((e: unknown) => toast("Couldn't render that", plainError(e)));
}

const secs = (ms: number | null) => (ms === null ? "" : `${Math.round(ms / 1000)} s`);
const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

const STATE_TEXT: Record<RenderView["state"], string> = {
  queued: "Waiting to render",
  running: "Rendering",
  done: "Rendered",
  failed: "Render stopped",
  cancelled: "Render cancelled",
};

/** One render's status, progress and actions. Used by the card and the drawer. */
export function RenderStatus({ r, compact = false }: { r: RenderView; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const act = (p: Promise<unknown>, what: string) => {
    setBusy(true);
    p.catch((e: unknown) => toast(what, plainError(e))).finally(() => setBusy(false));
  };
  const active = r.state === "queued" || r.state === "running";
  return (
    <div data-testid="render-status" data-state={r.state} className="min-w-0">
      <div className="flex items-center gap-2.5">
        {active ? (
          <Spinner size={14} />
        ) : r.state === "done" ? (
          <CheckIcon size={16} className="shrink-0 text-ok" />
        ) : (
          <AlertIcon
            size={16}
            className={`shrink-0 ${r.state === "failed" ? "text-bad" : "text-tertiary"}`}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-[15px]">
          {STATE_TEXT[r.state]}
          {!compact && <span className="text-secondary"> · {r.title}</span>}
        </span>
        {r.state === "running" && (
          <span className="text-[13px] text-tertiary tabular-nums">{Math.round(r.pct)}%</span>
        )}
      </div>
      {active && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-bubble-user">
          <div
            className="h-full rounded-full bg-unread transition-[width] duration-500"
            style={{ width: `${r.state === "running" ? r.pct : 0}%` }}
          />
        </div>
      )}
      {r.state === "done" && r.file !== null && (
        <p
          data-testid="render-file"
          className="mt-1.5 truncate text-[13px] text-tertiary select-text"
          title={r.file}
        >
          {fileName(r.file)} · 1080 × 1920 · {secs(r.durationMs)}
        </p>
      )}
      {r.state === "failed" && r.message !== null && (
        <p className="mt-1.5 text-[13px] leading-snug text-secondary">{r.message}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {active && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="render-cancel"
            disabled={busy}
            onClick={() =>
              act(window.alcyo.invoke("render:cancel", { renderId: r.renderId }), "Couldn't cancel")
            }
          >
            Cancel
          </Button>
        )}
        {r.state === "done" && r.file !== null && (
          <>
            <Button
              size="sm"
              data-testid="render-reveal"
              onClick={() =>
                act(
                  window.alcyo.invoke("render:reveal", {
                    streamId: r.streamId,
                    renderId: r.renderId,
                  }),
                  "Couldn't show the file",
                )
              }
            >
              {navigator.userAgent.includes("Mac") ? "Show in Finder" : "Show in Explorer"}
            </Button>
            <CopyButton text={r.file} label="Copy path" />
          </>
        )}
        {(r.state === "failed" || r.state === "cancelled") && (
          <Button
            size="sm"
            data-testid="render-retry"
            disabled={busy}
            onClick={() =>
              act(window.alcyo.invoke("render:retry", { renderId: r.renderId }), "Couldn't retry")
            }
          >
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

/** The render message in a thread. */
export function RenderBubble({ streamId, renderId }: { streamId: string; renderId: string }) {
  const live = useRenders((s) => s.byId[renderId]);
  const [loaded, setLoaded] = useState<RenderView | null | undefined>(undefined);
  useEffect(() => {
    if (live !== undefined) return;
    let on = true;
    window.alcyo.invoke("render:get", { streamId, renderId }).then(
      (r) => on && setLoaded(r),
      () => on && setLoaded(null),
    );
    return () => {
      on = false;
    };
  }, [live, streamId, renderId]);
  const r = live ?? loaded;
  return (
    <div
      data-testid="render-message"
      className="w-full max-w-md rounded-bubble bg-bubble-claude px-5 py-4"
    >
      {r === undefined ? (
        <Spinner size={14} />
      ) : r === null ? (
        <div className="flex items-center gap-2.5 text-[14px] text-secondary">
          <FilmIcon size={16} className="shrink-0" />
          This render didn&apos;t finish before Alcyo closed. Render the short again.
        </div>
      ) : (
        <>
          <p className="mb-2 truncate text-[13px] text-tertiary">
            “{r.title}” v{r.version}
          </p>
          <RenderStatus r={r} compact />
        </>
      )}
    </div>
  );
}
