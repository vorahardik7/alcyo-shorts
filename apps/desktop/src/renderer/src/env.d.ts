import type { AlcyoBridge } from "@alcyo/ipc";

declare global {
  interface Window {
    readonly alcyo: AlcyoBridge;
  }
}
