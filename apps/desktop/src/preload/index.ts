// Exposes window.alcyo with invoke and on. Nothing else.
// Only names from the contract get through; main parses every payload.
//
// It also reads the paths of files dropped on the window and hands them to
// main directly. The page gets only a token and the names (drop:files), so it
// never sees or sends a path.
import { PRELOAD_CHANNEL, isChannel, isEventName } from "@alcyo/ipc/names";
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from "electron";

const bridge = {
  invoke(channel: unknown, input: unknown): Promise<unknown> {
    if (!isChannel(channel)) return Promise.reject(new Error("Unknown channel."));
    return ipcRenderer.invoke(channel, input);
  },
  on(event: unknown, listener: unknown): () => void {
    if (!isEventName(event) || typeof listener !== "function") {
      throw new Error("Unknown event.");
    }
    const wrapped = (_e: IpcRendererEvent, payload: unknown) =>
      (listener as (payload: unknown) => void)(payload);
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("alcyo", bridge);

// The preload has the DOM at run time; the main tsconfig has no DOM types.
interface DropTarget {
  addEventListener(
    type: "drop",
    fn: (event: { dataTransfer: { files: ArrayLike<File> } | null }) => void,
    capture: boolean,
  ): void;
}
(globalThis as unknown as DropTarget).addEventListener(
  "drop",
  (event) => {
    const files = event.dataTransfer === null ? [] : Array.from(event.dataTransfer.files);
    const paths = files
      .slice(0, 20)
      .map((file) => webUtils.getPathForFile(file))
      .filter((path) => path.length > 0);
    if (paths.length > 0)
      void ipcRenderer.invoke(PRELOAD_CHANNEL, { paths }).catch(() => undefined);
  },
  true,
);
