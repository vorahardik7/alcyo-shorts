// Small marks for the agents in the model picker and settings. Simple,
// original shapes in each agent's usual colour; not the vendors' logos.
import type { LocalAgentId } from "@alcyo/schema";

export type PickerAgent = LocalAgentId | "api";

export function AgentIcon({ id, size = 16 }: { id: PickerAgent; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true } as const;
  switch (id) {
    case "claude":
      // A six-arm burst.
      return (
        <svg {...common}>
          <g stroke="#D97757" strokeWidth="1.9" strokeLinecap="round">
            <path d="M8 1.8v12.4M2.6 4.9l10.8 6.2M2.6 11.1l10.8-6.2" />
          </g>
        </svg>
      );
    case "grok":
      // A ring cut by a slash.
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.2" fill="none" stroke="#E7E7EA" strokeWidth="1.6" />
          <path d="M3 13 13 3" stroke="#E7E7EA" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "codex":
      // Two linked rounded squares.
      return (
        <svg {...common}>
          <g fill="none" stroke="#E7E7EA" strokeWidth="1.5">
            <rect x="2" y="2" width="8" height="8" rx="2.4" />
            <rect x="6" y="6" width="8" height="8" rx="2.4" />
          </g>
        </svg>
      );
    case "api":
      return (
        <svg {...common}>
          <g fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="5.5" cy="10.5" r="3" />
            <path d="m7.7 8.3 5.8-5.8M11.5 4.5l1.6 1.6" />
          </g>
        </svg>
      );
  }
}
