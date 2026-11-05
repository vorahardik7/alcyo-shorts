// Short notices at the bottom of the window. One at a time; a new one
// replaces the old.
import { create } from "zustand";
import { useEffect } from "react";
import { useEscape } from "../nav/overlays";
import { CloseIcon, InfoIcon } from "./icons";

interface Toast {
  id: number;
  title: string;
  body?: string;
}

interface ToastStore {
  current: Toast | null;
  show: (title: string, body?: string) => void;
  dismiss: () => void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  current: null,
  show: (title, body) =>
    set({ current: { id: nextId++, title, ...(body === undefined ? {} : { body }) } }),
  dismiss: () => set({ current: null }),
}));

export const toast = (title: string, body?: string) => useToasts.getState().show(title, body);

const DURATION_MS = 5000;

export function Toaster() {
  const current = useToasts((s) => s.current);
  const dismiss = useToasts((s) => s.dismiss);
  useEscape("overlay", current !== null, dismiss);

  useEffect(() => {
    if (current === null) return;
    const timer = setTimeout(dismiss, DURATION_MS);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  if (current === null) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-6">
      <div
        key={current.id}
        role="status"
        data-testid="toast"
        data-overlay
        className="toast-in pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border border-line-strong bg-[#1f2126] py-2.5 pr-1.5 pl-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
      >
        <InfoIcon size={16} className="mt-0.5 shrink-0 text-accent-soft" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">{current.title}</p>
          {current.body !== undefined && (
            <p className="mt-0.5 text-[13px] text-secondary">{current.body}</p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="grid size-7 shrink-0 place-items-center rounded-md text-secondary outline-none hover:bg-bubble-user hover:text-text focus-visible:ring-2 focus-visible:ring-unread"
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}
