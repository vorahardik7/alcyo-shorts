// Handlers for every channel in @alcyo/ipc's contract.
import type { AppInfo, Channel } from "@alcyo/ipc";
import type { HandlerFn } from "./core";

export interface HandlerDeps {
  appInfo(): AppInfo;
  pingWorker(text: string): Promise<string>;
  now(): number;
}

type Handlers = { [C in Channel]: HandlerFn<C> };

export function createHandlers(deps: HandlerDeps): Handlers {
  return {
    "app:info": () => deps.appInfo(),
    "worker:ping": async ({ text }) => {
      const started = deps.now();
      const reply = await deps.pingWorker(text);
      return { text: reply, ms: Math.max(0, Math.round(deps.now() - started)) };
    },
  };
}
