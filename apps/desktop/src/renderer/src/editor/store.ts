// The editor's state (plan section 6): the version being edited, an undo
// history of the short, the playhead, the selection, and zoom. Edits go
// through apply(), so every one is undoable. Main owns saving.
import type { EditorView } from "@alcyo/ipc";
import { buildAss } from "@alcyo/render";
import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  type Result,
  type Short,
  shortDuration,
} from "@alcyo/schema";
import { create } from "zustand";
import type { PlayerHandle } from "../streams/player";
import { toast } from "../ui/toast";
import { type History, push, redo, start, undo } from "./history";

export { saveNote } from "./history";

export const ZOOM_STEPS = [8, 12, 20, 32, 50, 80, 120, 200] as const;
const DEFAULT_ZOOM = 3;

export interface Selection {
  /** Short ms, from <= to. */
  from: number;
  to: number;
}

export type Panel = "transcript" | "captions" | "reframe" | "hook";

interface EditorState {
  view: EditorView | null;
  streamId: string;
  shortId: string;
  /** The version edits branch from; saving records it as the parent. */
  base: number;
  history: History<Short>;
  /** The short as last saved (or loaded), to tell if there are unsaved edits. */
  saved: Short | null;
  /** History length when last saved, for the version note. */
  savedAt: number;
  t: number;
  sel: Selection | null;
  /** Selected transcript words, as an anchor and a focus word id. */
  words: { anchor: string; focus: string } | null;
  /** Selected crop key index. */
  key: number | null;
  zoom: number;
  panel: Panel;
  guides: boolean;
  /** Pixels per second on the timeline. */
  pxPerSec: () => number;
  player: PlayerHandle | null;
  load: (streamId: string, view: EditorView, useDraft: boolean) => void;
  apply: (label: string, fn: (s: Short) => Short | Result<Short>) => boolean;
  undo: () => void;
  redo: () => void;
  setT: (t: number) => void;
  seek: (t: number) => void;
  set: (patch: Partial<EditorState>) => void;
  markSaved: (short: Short, version: number, view?: EditorView) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  view: null,
  streamId: "",
  shortId: "",
  base: 1,
  history: start({} as Short),
  saved: null,
  savedAt: 0,
  t: 0,
  sel: null,
  words: null,
  key: null,
  zoom: DEFAULT_ZOOM,
  panel: "transcript",
  guides: true,
  pxPerSec: () => ZOOM_STEPS[get().zoom]!,
  player: null,

  load: (streamId, view, useDraft) => {
    const short = useDraft && view.draft !== null ? view.draft.short : view.version.short;
    set({
      view,
      streamId,
      shortId: view.version.shortId,
      base: view.version.version,
      history: start(short, useDraft && view.draft !== null ? "Restored the autosave" : "Opened"),
      saved: view.version.short,
      savedAt: 0,
      t: 0,
      sel: null,
      words: null,
      key: null,
    });
  },

  apply: (label, fn) => {
    const cur = get().history.present.value;
    const out = fn(cur);
    if ("ok" in out && typeof out.ok === "boolean") {
      const r = out;
      if (!r.ok) {
        toast("Can't do that", r.reason);
        return false;
      }
      set({ history: push(get().history, r.value, label) });
      return true;
    }
    set({ history: push(get().history, out, label) });
    return true;
  },

  undo: () => {
    const h = get().history;
    if (h.past.length === 0) return;
    toast("Undid", h.present.label);
    set({ history: undo(h) });
  },
  redo: () => {
    const h = get().history;
    if (h.future.length === 0) return;
    toast("Redid", h.future[0]!.label);
    set({ history: redo(h) });
  },
  setT: (t) => set({ t }),
  seek: (t) => {
    const p = get().player;
    const dur = shortDuration(get().history.present.value.segments);
    const c = Math.max(0, Math.min(Math.max(0, dur - 1), Math.round(t)));
    if (p !== null) p.seek(c);
    else set({ t: c });
  },
  set: (patch) => set(patch),
  markSaved: (short, version, view) =>
    set((s) => ({
      saved: short,
      base: version,
      savedAt: s.history.past.length,
      ...(view === undefined ? {} : { view }),
    })),
}));

export const current = () => useEditor.getState().history.present.value;

/** True when the short differs from what was last saved. */
export function useDirty(): boolean {
  return useEditor((s) => s.saved !== null && s.history.present.value !== s.saved);
}

/** The .ass for the current short: the same builder and presets the render uses. */
export function assFor(view: EditorView, short: Short): string {
  const caption =
    view.captionPresets.find((p) => p.id === short.captions.presetId) ??
    BUILTIN_CAPTION_PRESETS[0]!;
  const hook =
    view.hookPresets.find((p) => p.id === short.hook?.presetId) ?? BUILTIN_HOOK_PRESETS[0]!;
  return buildAss({ short, words: view.words, caption, hook });
}
