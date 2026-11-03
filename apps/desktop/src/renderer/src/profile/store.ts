// The creator profile from main, shared by onboarding, Home and Settings.
import type { ProfileView } from "@alcyo/ipc";
import { create } from "zustand";
import { plainError } from "../streams/store";

interface ProfileStore {
  view: ProfileView | null;
  error: string | null;
  load: () => Promise<void>;
  set: (view: ProfileView) => void;
}

export const useProfile = create<ProfileStore>((set) => ({
  view: null,
  error: null,
  load: async () => {
    try {
      set({ view: await window.alcyo.invoke("profile:get", {}), error: null });
    } catch (error) {
      set({ error: plainError(error) });
    }
  },
  set: (view) => set({ view, error: null }),
}));

/** Keeps the profile fresh while the app runs. Call once, from the layout. */
export function watchProfile(): () => void {
  void useProfile.getState().load();
  return window.alcyo.on("profile:changed", () => void useProfile.getState().load());
}
