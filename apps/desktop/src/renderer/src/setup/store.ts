// The setup report and app facts from main, shared by Setup, Settings and the
// sidebar.
import type { AppInfo, AppPaths, SetupReport } from "@alcyo/ipc";
import { create } from "zustand";

interface SetupStore {
  report: SetupReport | null;
  loading: boolean;
  error: string | null;
  /** "Skip for now" was pressed this session. */
  skipped: boolean;
  load: (fresh?: boolean) => Promise<void>;
  skip: () => void;
}

export const useSetup = create<SetupStore>((set, get) => ({
  report: null,
  loading: false,
  error: null,
  skipped: false,
  load: async (fresh = false) => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const report = await window.alcyo.invoke("setup:check", fresh ? { fresh: true } : {});
      set({ report, loading: false });
    } catch {
      set({
        loading: false,
        error:
          "The setup check didn't finish. Press Check again; if it keeps failing, restart the app.",
      });
    }
  },
  skip: () => set({ skipped: true }),
}));

interface AppFacts {
  info: AppInfo | null;
  paths: AppPaths | null;
  load: () => void;
}

export const useAppFacts = create<AppFacts>((set, get) => ({
  info: null,
  paths: null,
  load: () => {
    if (get().info !== null) return;
    window.alcyo.invoke("app:info", {}).then(
      (info) => set({ info }),
      () => undefined,
    );
    window.alcyo.invoke("app:paths", {}).then(
      (paths) => set({ paths }),
      () => undefined,
    );
  },
}));

export function openIssues(report: SetupReport): number {
  return report.checks.filter((c) => c.required && c.state !== "pass").length;
}
