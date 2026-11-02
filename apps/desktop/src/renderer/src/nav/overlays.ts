// Esc handling. Overlays (drawer, search, toasts) and non-thread screens
// register a close function; Esc runs the topmost overlay's, or, with no
// overlay open, the current screen's (which goes back).
import { useEffect, useRef } from "react";
import { create } from "zustand";

type Kind = "overlay" | "screen";
interface Entry {
  id: number;
  kind: Kind;
  close: () => void;
}

interface EscStore {
  entries: Entry[];
  add: (entry: Entry) => void;
  remove: (id: number) => void;
}

export const useEscStore = create<EscStore>((set) => ({
  entries: [],
  add: (entry) => set((s) => ({ entries: [...s.entries, entry] })),
  remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
}));

let nextId = 1;

/** Registers a close function for Esc while `active` is true. */
export function useEscape(kind: Kind, active: boolean, close: () => void): void {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!active) return;
    const id = nextId++;
    useEscStore.getState().add({ id, kind, close: () => latest.current() });
    return () => useEscStore.getState().remove(id);
  }, [active, kind]);
}

/** Runs the right close function for one Esc press. Returns false if none. */
export function handleEscape(): boolean {
  const { entries } = useEscStore.getState();
  const overlays = entries.filter((e) => e.kind === "overlay");
  const top = overlays.at(-1) ?? entries.filter((e) => e.kind === "screen").at(-1);
  if (top === undefined) return false;
  top.close();
  return true;
}
