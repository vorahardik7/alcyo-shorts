// The composer's model picker, laid out like T3 Code's: a trigger with the
// agent's mark and the model name, and a popover above it with a rail of
// agents on the left and that agent's models on the right. Agents that
// aren't installed or signed in stay visible but can't be picked, with a note
// that points at Setup. The choice is saved in settings for every stream.
import type { AgentSelection } from "@alcyo/ipc";
import { AGENT_MODELS, type AgentModel, type LocalAgentId, type ProviderId } from "@alcyo/schema";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useEscape } from "../nav/overlays";
import { useSetup } from "../setup/store";
import { AgentIcon, type PickerAgent } from "../ui/AgentIcon";
import { CheckIcon, SearchIcon } from "../ui/icons";
import { toast } from "../ui/toast";
import { plainError } from "./store";

const PROVIDER: Record<PickerAgent, ProviderId> = {
  claude: "claude-cli",
  grok: "grok-cli",
  codex: "codex-cli",
  api: "anthropic-api",
};
const AGENT_OF: Record<ProviderId, PickerAgent> = {
  "claude-cli": "claude",
  "grok-cli": "grok",
  "codex-cli": "codex",
  "anthropic-api": "api",
};
const RAIL: PickerAgent[] = ["claude", "grok", "codex", "api"];
const NAME: Record<PickerAgent, string> = {
  claude: "Claude Code",
  grok: "Grok",
  codex: "Codex",
  api: "API key",
};
/** The API key runs Claude's models through the Messages API. */
const modelsOf = (a: PickerAgent): AgentModel[] => AGENT_MODELS[a === "api" ? "claude" : a].models;
const modelKey = (a: PickerAgent): LocalAgentId => (a === "api" ? "claude" : a);

interface PickStore {
  selection: AgentSelection | null;
  load: () => Promise<void>;
  set: (s: AgentSelection) => void;
}
export const useAgentPick = create<PickStore>((set) => ({
  selection: null,
  load: async () => {
    const selection = await window.alcyo.invoke("agent:get", {}).catch(() => null);
    if (selection !== null) set({ selection });
  },
  set: (selection) => set({ selection }),
}));

type Readiness = { ready: true } | { ready: false; why: string; fix: string };

function useReadiness(): (a: PickerAgent) => Readiness {
  const report = useSetup((s) => s.report);
  return (a) => {
    if (report === null) return { ready: false, why: "Checking", fix: "Checking this computer…" };
    if (a === "api") {
      return report.apiKey.present
        ? { ready: true }
        : { ready: false, why: "No key", fix: "Save an Anthropic API key in Settings to use it." };
    }
    const hit = report.agents.find((x) => x.id === a);
    if (hit === undefined || hit.path === null) {
      return { ready: false, why: "Not installed", fix: `Install ${NAME[a]}, then check again.` };
    }
    if (hit.signedIn !== true) {
      return {
        ready: false,
        why: "Not signed in",
        fix: `Sign in to ${NAME[a]} in a terminal, then check again.`,
      };
    }
    return { ready: true };
  };
}

/** Which agent answers now: the setup report's choice, or the saved key. */
function useActiveAgent(): PickerAgent | null {
  const report = useSetup((s) => s.report);
  const selection = useAgentPick((s) => s.selection);
  if (report?.chosen != null) return report.chosen.id;
  if (report?.apiKey.present === true) return "api";
  return selection === null ? null : AGENT_OF[selection.provider];
}

export function ModelPicker({ compact = false }: { compact?: boolean }) {
  const selection = useAgentPick((s) => s.selection);
  const load = useAgentPick((s) => s.load);
  const active = useActiveAgent();
  const readiness = useReadiness();
  const [open, setOpen] = useState(false);
  // Opens above the composer card; below it when there isn't room (Home).
  const [below, setBelow] = useState(false);
  useEffect(() => {
    void load();
  }, [load]);

  const agent: PickerAgent = active ?? "claude";
  const modelId = selection?.models[modelKey(agent)] ?? modelsOf(agent)[0]!.id;
  const model = modelsOf(agent).find((m) => m.id === modelId) ?? modelsOf(agent)[0]!;
  const none = active === null || !readiness(agent).ready;

  return (
    // Not relative: the panel anchors to the composer card, as in T3 Code.
    <div className="min-w-0">
      <button
        type="button"
        data-testid="model-picker"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          none
            ? "No agent is ready. Pick one to see what it needs."
            : `${NAME[agent]} · ${model.label}`
        }
        onClick={(e) => {
          const card = e.currentTarget.closest('[data-testid="composer"]');
          setBelow(card !== null && card.getBoundingClientRect().top < 362);
          setOpen((o) => !o);
        }}
        className={`no-drag flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[14px] font-medium outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-accent ${
          open ? "bg-white/[0.06] text-text" : "text-text/80"
        }`}
      >
        <AgentIcon id={agent} size={16} />
        <span className="max-w-56 truncate">
          {none ? "No agent" : compact ? model.label : `${NAME[agent]} · ${model.label}`}
        </span>
        {none && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warn" />}
      </button>
      {open && (
        <PickerPanel
          activeAgent={agent}
          activeModel={model.id}
          below={below}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function PickerPanel({
  activeAgent,
  activeModel,
  below,
  onClose,
}: {
  activeAgent: PickerAgent;
  activeModel: string;
  below: boolean;
  onClose: () => void;
}) {
  useEscape("overlay", true, onClose);
  const readiness = useReadiness();
  const selection = useAgentPick((s) => s.selection);
  const setSelection = useAgentPick((s) => s.set);
  const reload = useSetup((s) => s.load);
  const [rail, setRail] = useState<PickerAgent>(activeAgent);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  // Typing searches every agent, like T3 Code; empty shows the rail's agent.
  const rows = useMemo(() => {
    const agents = q.length > 0 ? RAIL : [rail];
    return agents.flatMap((a) =>
      modelsOf(a)
        .filter((m) => q.length === 0 || `${m.label} ${m.id} ${NAME[a]}`.toLowerCase().includes(q))
        .map((m) => ({ agent: a, model: m })),
    );
  }, [q, rail]);
  // The highlight resets when the list changes: keyed by the query and rail.
  const listKey = `${rail}|${q}`;
  const [hiState, setHiState] = useState({ key: listKey, i: 0 });
  const hi = hiState.key === listKey ? hiState.i : 0;
  const setHi = (f: number | ((h: number) => number)) =>
    setHiState({ key: listKey, i: typeof f === "function" ? f(hi) : f });

  const pick = (a: PickerAgent, m: AgentModel) => {
    const r = readiness(a);
    if (!r.ready || busy) return;
    setBusy(true);
    void (async () => {
      await window.alcyo.invoke("agent:setModel", { agent: modelKey(a), model: m.id });
      if (a !== activeAgent) await window.alcyo.invoke("agent:use", { provider: PROVIDER[a] });
      const next = await window.alcyo.invoke("agent:get", {});
      setSelection(next);
      if (a !== activeAgent) await reload(true);
      onClose();
    })()
      .catch((e: unknown) => toast("Couldn't switch the model", plainError(e)))
      .finally(() => setBusy(false));
  };

  const railReady = readiness(rail);
  const shownModel = (a: PickerAgent) =>
    a === activeAgent ? activeModel : selection?.models[modelKey(a)];

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Choose a model"
        data-overlay
        data-testid="model-picker-panel"
        className={`fade-in absolute right-0 z-40 flex h-[300px] w-[360px] overflow-hidden rounded-lg border border-white/10 bg-[#141416] shadow-[0_18px_44px_-18px_rgba(0,0,0,0.8)] ${
          below ? "top-full mt-2" : "bottom-full mb-2"
        }`}
      >
        {/* Agent rail */}
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Agents"
          className="relative flex w-11 shrink-0 flex-col gap-1 bg-white/[0.015] p-1"
        >
          {RAIL.map((a) => {
            const r = readiness(a);
            const on = q.length === 0 && rail === a;
            return (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={`${NAME[a]}${r.ready ? "" : `, ${r.why.toLowerCase()}`}`}
                title={r.ready ? NAME[a] : `${NAME[a]} · ${r.why}`}
                onClick={() => {
                  setRail(a);
                  setQuery("");
                  search.current?.focus();
                }}
                className={`relative grid aspect-square place-items-center rounded-md outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-accent ${r.ready ? "" : "opacity-50"}`}
              >
                <AgentIcon id={a} size={17} />
                {on && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 -right-1 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Models */}
        <div className="flex min-w-0 flex-1 flex-col border-l border-white/[0.07]">
          <label className="mx-3 mt-2.5 flex shrink-0 items-center gap-1.5 border-b border-white/[0.08] pb-1.5 focus-within:border-white/20">
            <SearchIcon size={15} className="shrink-0 text-tertiary/70" />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models..."
              aria-label="Search models"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHi((h) => Math.min(rows.length - 1, h + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHi((h) => Math.max(0, h - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const row = rows[hi];
                  if (row !== undefined) pick(row.agent, row.model);
                } else if (e.key === "ArrowLeft" && query.length === 0) {
                  const i = RAIL.indexOf(rail);
                  setRail(RAIL[(i + RAIL.length - 1) % RAIL.length]!);
                } else if (e.key === "ArrowRight" && query.length === 0) {
                  const i = RAIL.indexOf(rail);
                  setRail(RAIL[(i + 1) % RAIL.length]!);
                }
              }}
              className="h-6.5 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-tertiary"
            />
          </label>
          <ul
            role="listbox"
            aria-label={`${NAME[rail]} models`}
            className="min-h-0 flex-1 overflow-y-auto p-1 pt-1.5"
          >
            {rows.map(({ agent: a, model: m }, i) => {
              const r = readiness(a);
              const selected = a === activeAgent && m.id === activeModel;
              const saved = shownModel(a) === m.id;
              return (
                <li key={`${a}:${m.id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={!r.ready}
                    data-testid={`model-${a}-${m.id}`}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(a, m)}
                    title={m.hint}
                    className={`flex min-h-7 w-full items-center gap-2 rounded-sm px-2 text-left outline-none ${
                      i === hi ? "bg-white/[0.09]" : ""
                    } ${r.ready ? "" : "cursor-default [&_*]:!text-tertiary"}`}
                  >
                    <AgentIcon id={a} size={16} />
                    <span className="shrink-0 text-[14px] text-text">{m.label}</span>
                    {selected && (
                      <CheckIcon size={14} strokeWidth={2.2} className="shrink-0 text-text" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px] text-tertiary/80">
                      {q.length > 0 ? NAME[a] : (m.hint ?? "")}
                    </span>
                    {!selected && a !== activeAgent && saved && r.ready && (
                      <span className="shrink-0 text-[11px] text-tertiary">Saved</span>
                    )}
                  </button>
                </li>
              );
            })}
            {rows.length === 0 && (
              <li className="px-2 py-3 text-[12px] text-tertiary">No models match “{query}”.</li>
            )}
          </ul>
          {q.length === 0 && !railReady.ready && (
            <div className="shrink-0 border-t border-white/[0.07] p-2 text-[12px] leading-[18px] text-secondary">
              <span className="font-medium text-warn">{railReady.why}.</span> {railReady.fix}{" "}
              {rail === "api" ? (
                <Link
                  to="/settings/$section"
                  params={{ section: "claude" }}
                  onClick={onClose}
                  className="font-medium text-text underline-offset-2 hover:underline"
                >
                  Open Settings
                </Link>
              ) : (
                <Link
                  to="/setup"
                  onClick={onClose}
                  className="mt-1.5 inline-flex h-7 items-center rounded-md bg-white/[0.08] px-2.5 font-medium text-text hover:bg-white/[0.12]"
                >
                  Open Setup
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
