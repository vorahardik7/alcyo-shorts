// Exposes window.alcyo with invoke and on. Nothing else.
// Only names from the contract get through; main parses every payload.
import { isChannel, isEventName } from "@alcyo/ipc/names";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

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
