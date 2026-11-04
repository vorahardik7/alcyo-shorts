// Undo and redo for the editor (plan section 6): snapshots of the short, at
// least 200 steps. Each step has a label, so the menu can say what Undo does.
// Pure, so it's tested without the DOM.

export const HISTORY_LIMIT = 500;

export interface Step<T> {
  value: T;
  label: string;
}

export interface History<T> {
  past: Step<T>[];
  present: Step<T>;
  future: Step<T>[];
}

export function start<T>(value: T, label = "Opened"): History<T> {
  return { past: [], present: { value, label }, future: [] };
}

/** A new step. Same value as now: nothing happens. Redo steps are dropped. */
export function push<T>(h: History<T>, value: T, label: string, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(value, h.present.value)) return h;
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: { value, label }, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past.at(-1);
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

/** The version note: what was done since the last save, in a few words. */
export function saveNote<T>(h: History<T>, savedAt: number): string {
  if (h.past.length <= savedAt) return "Edited in the editor";
  const labels = [...h.past.slice(savedAt + 1), h.present]
    .map((s) => s.label)
    .filter((l) => l !== "Opened" && l.length > 0);
  const unique = [...new Set(labels)];
  if (unique.length === 0) return "Edited in the editor";
  const text = unique.slice(0, 4).join(", ");
  return (unique.length > 4 ? `${text}, and more` : text).slice(0, 200);
}
