// Handlers for every channel in @alcyo/ipc's contract.
import type { AppInfo, AppPaths, Channel, SetupReport } from "@alcyo/ipc";
import type { HandlerFn } from "./core";

export interface HandlerDeps {
  appInfo(): AppInfo;
  appPaths(): AppPaths;
  openDataFolder(): Promise<void>;
  setupCheck(fresh: boolean): Promise<SetupReport>;
  pingWorker(text: string): Promise<string>;
  now(): number;
}

type Handlers = { [C in Channel]: HandlerFn<C> };

export function createHandlers(deps: HandlerDeps): Handlers {
  return {
    "app:info": () => deps.appInfo(),
    "app:paths": () => deps.appPaths(),
    "shell:openDataFolder": async () => {
      await deps.openDataFolder();
      return {};
    },
    "setup:check": ({ fresh }) => deps.setupCheck(fresh === true),
    "worker:ping": async ({ text }) => {
      const started = deps.now();
      const reply = await deps.pingWorker(text);
      return { text: reply, ms: Math.max(0, Math.round(deps.now() - started)) };
    },
  };
}
