// Back, forward and the window title, on top of TanStack Router's history.
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { closeTopOverlay, escapeScreen } from "./overlays";

export const isMac = /Mac/.test(navigator.userAgent);

/**
 * Moving between Settings sections replaces the history entry instead of
 * adding one, so history only grows when you change screens. Back, Esc and
 * Cmd+[ from any section then leave Settings for wherever you were before it,
 * usually the chat.
 */
export function inSettings(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** Back one screen when there is one, otherwise home. */
export function useBack(): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: "/" });
  }, [router]);
}

/** Sets the window title to "<place> · Alcyo Shorts". */
export function usePageTitle(place: string): void {
  useEffect(() => {
    document.title = `${place} · Alcyo Shorts`;
  }, [place]);
}

/** Shell UI state: the sidebar search box, and requests to focus the composer. */
interface UiStore {
  searchOpen: boolean;
  query: string;
  setSearch: (open: boolean) => void;
  setQuery: (query: string) => void;
  composerFocus: number;
  focusComposer: () => void;
}

export const useUi = create<UiStore>((set) => ({
  searchOpen: false,
  query: "",
  setSearch: (open) => set(open ? { searchOpen: true } : { searchOpen: false, query: "" }),
  setQuery: (query) => set({ query }),
  composerFocus: 0,
  focusComposer: () => set((s) => ({ composerFocus: s.composerFocus + 1 })),
}));

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/**
 * App-wide keys: Esc, Cmd+[ / Cmd+] (Ctrl on Windows, plus Alt+Left/Right),
 * Cmd/Ctrl+, for Settings, Cmd/Ctrl+F for search, and the mouse's back and
 * forward buttons.
 */
export function useNavShortcuts(): void {
  const router = useRouter();

  useEffect(() => {
    const back = () => router.history.back();
    const forward = () => router.history.forward();

    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === "Escape") {
        // Order: the topmost overlay, then leaving a text field, then the
        // screen's own Esc (Back on non-thread screens).
        e.preventDefault();
        if (closeTopOverlay()) return;
        const active = document.activeElement;
        if (isTextField(active)) {
          active.blur();
          return;
        }
        escapeScreen();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && (e.key === "[" || e.code === "BracketLeft")) {
        e.preventDefault();
        back();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && (e.key === "]" || e.code === "BracketRight")) {
        e.preventDefault();
        forward();
        return;
      }
      if (!isMac && e.altKey && !e.ctrlKey && e.key === "ArrowLeft") {
        e.preventDefault();
        back();
        return;
      }
      if (!isMac && e.altKey && !e.ctrlKey && e.key === "ArrowRight") {
        e.preventDefault();
        forward();
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        void router.navigate({
          to: "/settings",
          replace: inSettings(router.state.location.pathname),
        });
        return;
      }
      if (mod && (e.key === "f" || e.key === "F") && !e.shiftKey) {
        e.preventDefault();
        useUi.getState().setSearch(true);
      }
    };

    // Mouse buttons 3 and 4 are back and forward.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        back();
      } else if (e.button === 4) {
        e.preventDefault();
        forward();
      }
    };
    const swallow = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousedown", swallow);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousedown", swallow);
    };
  }, [router]);
}
