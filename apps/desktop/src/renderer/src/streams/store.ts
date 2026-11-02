// Streams and the open stream's thread, from main.
import type { StreamDetail, StreamSummary } from "@alcyo/ipc";
import type { Message } from "@alcyo/schema";
import { create } from "zustand";
import { toast } from "../ui/toast";

/** Main's errors arrive as "Error invoking remote method 'x': StoreError: <message>". */
export function plainError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const m = /^Error invoking remote method '[^']+': (?:\w*Error: )?([\s\S]*)$/.exec(text);
  return (m?.[1] ?? text).trim();
}

interface StreamsStore {
  streams: StreamSummary[];
  loaded: boolean;
  load: () => Promise<void>;
}

export const useStreams = create<StreamsStore>((set) => ({
  streams: [],
  loaded: false,
  load: async () => {
    try {
      set({ streams: await window.alcyo.invoke("streams:list", {}), loaded: true });
    } catch (error) {
      set({ loaded: true });
      toast("Couldn't load your streams", plainError(error));
    }
  },
}));

/** Keeps the list fresh while the app runs. Call once, from the layout. */
export function watchStreams(): () => void {
  void useStreams.getState().load();
  return window.alcyo.on("streams:changed", () => void useStreams.getState().load());
}

/** Merges a message (or a new rev of one) into a list, keeping order. */
export function mergeMessage(list: readonly Message[], message: Message): Message[] {
  const at = list.findIndex((m) => m.id === message.id);
  if (at === -1) return [...list, message];
  if (list[at]!.rev > message.rev) return list as Message[];
  const next = list.slice();
  next[at] = message;
  return next;
}

/** Choose a file: main shows the dialog and makes the stream. Resolves to its id. */
export async function chooseFile(): Promise<string | null> {
  try {
    const out = await window.alcyo.invoke("source:chooseFile", {});
    return "cancelled" in out ? null : out.stream.streamId;
  } catch (error) {
    toast("Couldn't add that file", plainError(error));
    return null;
  }
}

export type { StreamDetail };
