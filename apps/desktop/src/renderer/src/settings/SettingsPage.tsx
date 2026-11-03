// Settings (plan section 4): Profile, Claude, Models, Encoder, Storage, About.
// Full window: the settings nav takes the sidebar's place, and Back returns to
// the chat. Every value comes from main; unbuilt parts carry a quiet "Soon".
import type { DownloaderInfo, LocalAgentId, SetupCheck, SetupReport } from "@alcyo/ipc";
import { Link } from "@tanstack/react-router";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import license from "../../../../../../LICENSE?raw";
import notices from "../../../../../../THIRD_PARTY_NOTICES.md?raw";
import { BackButton } from "../nav/BackButton";
import { isMac, useBack, usePageTitle } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { ProfileSettings } from "../profile/ProfileSettings";
import { DownloadButton } from "../setup/download";
import { openIssues, useAppFacts, useSetup } from "../setup/store";
import { plainError, useStreams } from "../streams/store";
import { AppMark } from "../ui/AppMark";
import { Button, ButtonLink } from "../ui/Button";
import {
  ChatIcon,
  CpuIcon,
  FolderIcon,
  InfoIcon,
  RefreshIcon,
  UserIcon,
  WaveIcon,
} from "../ui/icons";
import { Card, ComesIn, CopyButton, Row, Spinner, StateBadge } from "../ui/parts";
import { toast } from "../ui/toast";

export type SectionId = "profile" | "claude" | "models" | "encoder" | "storage" | "about";

type IconC = ComponentType<{ size?: number }>;
const SECTIONS: Array<{ id: SectionId; label: string; icon: IconC; group: string }> = [
  { id: "profile", label: "Profile", icon: UserIcon, group: "You" },
  { id: "claude", label: "Agents", icon: ChatIcon, group: "You" },
  { id: "models", label: "Models", icon: WaveIcon, group: "This computer" },
  { id: "encoder", label: "Encoder", icon: CpuIcon, group: "This computer" },
  { id: "storage", label: "Storage", icon: FolderIcon, group: "This computer" },
  { id: "about", label: "About", icon: InfoIcon, group: "Alcyo" },
];

function sectionLink(id: SectionId) {
  return id === "profile"
    ? ({ to: "/settings/profile" } as const)
    : ({ to: "/settings/$section", params: { section: id } } as const);
}

function check(report: SetupReport | null, id: SetupCheck["id"]): SetupCheck | undefined {
  return report?.checks.find((c) => c.id === id);
}

function Waiting() {
  return (
    <span className="inline-flex items-center gap-2 text-secondary">
      <Spinner size={14} /> Checking…
    </span>
  );
}

function YesNo({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  return <StateBadge state={value ? "pass" : "fail"}>{value ? yes : no}</StateBadge>;
}

function CheckAgain() {
  const { load, loading } = useSetup();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void load(true)}
      disabled={loading}
      data-testid="check-again"
    >
      {loading ? <Spinner size={12} /> : <RefreshIcon size={14} />}
      Check again
    </Button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[13px] leading-relaxed text-tertiary">{children}</p>;
}

const AGENT_LABEL: Record<LocalAgentId, string> = {
  claude: "Claude Code",
  grok: "Grok",
  codex: "Codex",
};

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Try again.";
}

type AgentRowId = LocalAgentId | "api";
const PROVIDER: Record<LocalAgentId, "claude-cli" | "grok-cli" | "codex-cli"> = {
  claude: "claude-cli",
  grok: "grok-cli",
  codex: "codex-cli",
};
/** A colored monogram per agent, not their logos. */
const AGENT_BADGE: Record<AgentRowId, { text: string; className: string }> = {
  claude: { text: "C", className: "bg-[#D97757]/15 text-[#E8A487]" },
  grok: { text: "G", className: "bg-white/[0.08] text-text" },
  codex: { text: "X", className: "bg-[#10A37F]/15 text-[#5FD3AE]" },
  api: { text: "K", className: "bg-unread/15 text-[#9DB8FF]" },
};

interface AgentState {
  headline: string;
  detail: string;
  tone: "ok" | "warn" | "bad" | "idle";
}

/** One status line per agent, like T3 Code's provider rows. No paths. */
function agentState(report: SetupReport | null, id: LocalAgentId): AgentState {
  if (report === null) {
    return { headline: "Checking", detail: "Looking for it on this computer.", tone: "idle" };
  }
  const hit = report.agents.find((agent) => agent.id === id);
  if (hit === undefined || hit.path === null) {
    return hit?.problem === "cmd-shim"
      ? {
          headline: "Needs the native program",
          detail: "Only a command shim is installed. Install the native program.",
          tone: "bad",
        }
      : {
          headline: "Not found",
          detail: `${AGENT_LABEL[id]} isn't installed, or it's in a folder Alcyo doesn't look in.`,
          tone: "idle",
        };
  }
  if (hit.signedIn !== true) {
    return {
      headline: "Not signed in",
      detail: `Installed, but not signed in. Sign in with ${id === "claude" ? "claude" : `${id} login`} in a terminal.`,
      tone: "warn",
    };
  }
  return report.chosen?.id === id
    ? { headline: "Signed in · in use", detail: "Alcyo sends its requests here.", tone: "ok" }
    : { headline: "Signed in", detail: "Ready. Choose it to send requests here.", tone: "ok" };
}

const TONE_DOT: Record<AgentState["tone"], string | null> = {
  ok: null,
  warn: "bg-warn",
  bad: "bg-bad",
  idle: null,
};

function Badge({ id, size = 20 }: { id: AgentRowId; size?: number }) {
  const b = AGENT_BADGE[id];
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      className={`grid shrink-0 place-items-center rounded-md font-semibold ${b.className}`}
    >
      {b.text}
    </span>
  );
}

function AgentListRow({
  id,
  selected,
  onSelect,
}: {
  id: AgentRowId;
  selected: boolean;
  onSelect: () => void;
}) {
  const report = useSetup((s) => s.report);
  const name = id === "api" ? "API key" : AGENT_LABEL[id];
  const hit = id === "api" ? undefined : report?.agents.find((a) => a.id === id);
  const state: AgentState =
    id === "api"
      ? report?.apiKey.present === true
        ? { headline: "Saved", detail: "", tone: "ok" }
        : { headline: "Not set", detail: "", tone: "idle" }
      : agentState(report, id);
  const dot = TONE_DOT[state.tone];
  const inUse =
    id === "api"
      ? report !== null && report.chosen === null && report.apiKey.present
      : report?.chosen?.id === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-testid={`agent-${id}`}
      onClick={onSelect}
      className={`group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-unread ${
        selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      }`}
    >
      <Badge id={id} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-medium">{name}</span>
          {hit?.version != null && (
            <code className="max-w-24 truncate text-[12px] text-tertiary">
              {/^\d/.test(hit.version) ? `v${hit.version}` : hit.version}
            </code>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-tertiary">
          {(inUse || dot !== null) && (
            <span
              data-testid={inUse ? `in-use-${id}` : undefined}
              className={`size-1.5 shrink-0 rounded-full ${inUse ? "bg-ok" : dot}`}
            />
          )}
          <span className={`truncate ${inUse ? "text-secondary" : ""}`}>{state.headline}</span>
        </span>
      </span>
    </button>
  );
}

/** A settings row: what it is on the left, its control on the right. */
function SettingRow({
  title,
  description,
  children,
  last = false,
}: {
  title: string;
  description: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3.5 ${last ? "" : "border-b border-hairline"}`}
    >
      <div className="min-w-[14rem] flex-1">
        <p className="text-[14px] font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-tertiary">{description}</p>
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

function AgentDetail({ id }: { id: LocalAgentId }) {
  const report = useSetup((s) => s.report);
  const load = useSetup((s) => s.load);
  const [busy, setBusy] = useState<"use" | "locate" | null>(null);
  const hit = report?.agents.find((agent) => agent.id === id);
  const state = agentState(report, id);
  const row = check(report, AGENT_CHECK[id]);
  const chosen = report?.chosen?.id === id;
  const ready = hit?.path != null && hit.signedIn === true;

  return (
    <div data-testid={`agent-detail-${id}`} className="min-w-0">
      <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <Badge id={id} size={32} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold">{AGENT_LABEL[id]}</h3>
          <p className="mt-0.5 text-[13px] text-secondary">
            {state.headline}. {state.detail}
          </p>
        </div>
        {ready && !chosen && (
          <Button
            size="sm"
            variant="primary"
            data-testid={`use-${id}`}
            disabled={busy !== null}
            onClick={() => {
              setBusy("use");
              window.alcyo
                .invoke("agent:use", { provider: PROVIDER[id] })
                .then(() => load(true))
                .catch((e: unknown) => toast("Couldn't switch agents", messageOf(e)))
                .finally(() => setBusy(null));
            }}
          >
            {busy === "use" && <Spinner size={12} />}
            Use {AGENT_LABEL[id]}
          </Button>
        )}
      </div>
      {row?.state === "fail" && row.fix !== null && (
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-3 text-[13px] text-[#fcd34d]">
          <span className="min-w-0 flex-1">{row.fix}</span>
          {row.command !== null && <CopyButton text={row.command} label="Copy command" />}
        </div>
      )}
      <SettingRow
        title="Version"
        description={hit?.version != null ? `Reported by ${id} --version.` : "Not found yet."}
      >
        <span className="text-[13px] text-secondary tabular-nums">{hit?.version ?? "—"}</span>
      </SettingRow>
      <SettingRow
        title="Program"
        last
        description={
          hit?.path != null
            ? "Found on this computer. Locate it only if Alcyo picked the wrong copy."
            : "Locate it if it's installed in a folder Alcyo doesn't look in."
        }
      >
        <Button
          size="sm"
          disabled={busy !== null}
          data-testid={`locate-${id}`}
          onClick={() => {
            setBusy("locate");
            void window.alcyo
              .invoke("setup:locateAgent", { id })
              .then(
                (out) => {
                  if ("rejected" in out) {
                    toast("That file didn't run", out.message);
                    return;
                  }
                  if ("path" in out) void load(true);
                },
                (error: unknown) => toast("Couldn't open the file dialog", messageOf(error)),
              )
              .finally(() => setBusy(null));
          }}
        >
          {busy === "locate" && <Spinner size={12} />}
          Locate…
        </Button>
      </SettingRow>
      {hit?.path != null && (
        <details className="group">
          <summary className="cursor-pointer list-none px-5 py-2.5 text-[12px] text-tertiary outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-unread">
            Show where it is
          </summary>
          <div className="flex items-center gap-2 px-5 pb-3">
            <code
              data-testid={`${id}-path`}
              className="min-w-0 flex-1 truncate font-mono text-[12px] text-secondary select-text"
              title={hit.path}
            >
              {hit.path}
            </code>
            <CopyButton text={hit.path} label="Copy" />
          </div>
        </details>
      )}
    </div>
  );
}

const AGENT_CHECK: Record<LocalAgentId, SetupCheck["id"]> = {
  claude: "claude",
  grok: "agent-grok",
  codex: "agent-codex",
};

function ApiKeyCard() {
  const report = useSetup((s) => s.report);
  const load = useSetup((s) => s.load);
  const present = report?.apiKey.present === true;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = key.trim();

  return (
    <div data-testid="api-key-card" className="min-w-0">
      <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <Badge id="api" size={32} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold">API key backup</h3>
          <p className="mt-0.5 text-[13px] text-secondary">
            Used only when no coding agent is signed in. The key stays on this computer.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 px-5 py-3">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          value={key}
          placeholder={present ? "Paste a new key to replace the saved one" : "Anthropic API key"}
          data-testid="api-key-input"
          onChange={(event) => setKey(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg bg-white/[0.04] px-3 text-[14px] ring-1 ring-hairline outline-none placeholder:text-tertiary focus-visible:ring-2 focus-visible:ring-unread"
        />
        <Button
          size="sm"
          disabled={busy || trimmed.length === 0}
          data-testid="api-key-save"
          onClick={() => {
            setBusy(true);
            void window.alcyo
              .invoke("settings:setApiKey", { key: trimmed })
              .then(
                () => {
                  setKey("");
                  return load(true);
                },
                (error: unknown) => toast("The key wasn't saved", messageOf(error)),
              )
              .finally(() => setBusy(false));
          }}
        >
          Save
        </Button>
        {present && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            data-testid="api-key-clear"
            onClick={() => {
              setBusy(true);
              void window.alcyo
                .invoke("settings:clearApiKey", {})
                .then(
                  () => load(true),
                  (error: unknown) => toast("The key wasn't removed", messageOf(error)),
                )
                .finally(() => setBusy(false));
            }}
          >
            Remove
          </Button>
        )}
      </div>
      <p className="px-5 pb-4 text-[13px] text-tertiary">
        {report === null
          ? "…"
          : present
            ? "A key is saved. Alcyo never shows it again."
            : "No key saved."}
      </p>
    </div>
  );
}

function SetupBanner() {
  const report = useSetup((s) => s.report);
  if (report === null || report.complete) return null;
  const n = openIssues(report);
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-warn/8 px-5 py-3.5 ring-1 ring-warn/20">
      <p className="min-w-0 flex-1 text-[14px]">
        <span className="font-medium">Setup isn&apos;t finished.</span>{" "}
        <span className="text-secondary">
          {n} {n === 1 ? "check needs" : "checks need"} attention.
        </span>
      </p>
      <ButtonLink to="/setup" size="sm" variant="primary">
        Open Setup
      </ButtonLink>
    </div>
  );
}

function ProfileSection() {
  return (
    <>
      <SetupBanner />
      <ProfileSettings />
    </>
  );
}

function ClaudeSection() {
  const report = useSetup((s) => s.report);
  const [selected, setSelected] = useState<AgentRowId>(() => report?.chosen?.id ?? "claude");
  const summary = check(report, "agent");
  const ids: AgentRowId[] = ["claude", "grok", "codex", "api"];
  return (
    <>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] text-secondary">
          Alcyo sends transcript text to one coding agent you&apos;re already signed in to. Its own
          login pays.
        </p>
        <CheckAgain />
      </div>
      {summary?.state === "fail" && (
        <p className="rounded-xl bg-warn/8 px-4 py-3 text-[13px] text-[#fcd34d] ring-1 ring-warn/20">
          {summary.fix}
        </p>
      )}
      <section
        data-testid="claude-card"
        aria-label="Coding agents"
        className="@container/agents overflow-hidden rounded-xl bg-card/60 ring-1 ring-hairline"
      >
        <div className="@min-[44rem]/agents:grid @min-[44rem]/agents:grid-cols-[16rem_minmax(0,1fr)]">
          <div
            role="tablist"
            aria-label="Agents"
            className="divide-y divide-hairline border-hairline @min-[44rem]/agents:border-r max-@min-[44rem]/agents:border-b"
          >
            {ids.map((id) => (
              <AgentListRow
                key={id}
                id={id}
                selected={selected === id}
                onSelect={() => setSelected(id)}
              />
            ))}
          </div>
          <div role="tabpanel" className="min-w-0">
            {selected === "api" ? <ApiKeyCard /> : <AgentDetail id={selected} />}
          </div>
        </div>
      </section>
      <Note>
        The agent sees transcript text and your profile, never video or audio. Alcyo never offers a
        login and never reads or stores an agent&apos;s credentials. A backup API key is encrypted
        by the operating system.{" "}
        <Link
          to="/setup"
          data-testid="open-setup"
          className="text-secondary underline-offset-2 hover:underline"
        >
          Open Setup
        </Link>
      </Note>
    </>
  );
}

function ModelsSection() {
  const report = useSetup((s) => s.report);
  const vad = check(report, "vad");
  const whisper = report?.tools.find((t) => t.name === "whisper-cli");
  return (
    <>
      <Card
        testId="models-card"
        title="Transcription"
        description="whisper.cpp turns speech into timed words on this computer."
        actions={<CheckAgain />}
      >
        <Row
          label="Model"
          aside={report !== null && !report.whisperModel.present ? <DownloadButton /> : undefined}
        >
          {report === null ? (
            <Waiting />
          ) : (
            <span className="flex items-center gap-2">
              {report.whisperModel.name}
              {report.whisperModel.present ? (
                <YesNo value yes="Downloaded" />
              ) : (
                <StateBadge state="pending">Not downloaded</StateBadge>
              )}
            </span>
          )}
        </Row>
        <Row label="whisper-cli">
          {report === null
            ? "…"
            : whisper?.present === true
              ? `Version ${whisper.version ?? "unknown"}`
              : "Missing"}
        </Row>
        <Row label="Silence detection">
          {vad === undefined ? (
            <Waiting />
          ) : (
            <span className="flex items-center gap-2">
              <StateBadge state={vad.state} />
              <span className="text-[13px] text-tertiary">Silero VAD</span>
            </span>
          )}
        </Row>
      </Card>
      <Note>
        Press Download to fetch the model. It stays on this computer. Silero skips silence so
        transcripts are faster.
      </Note>
    </>
  );
}

function EncoderSection() {
  const report = useSetup((s) => s.report);
  const ffmpeg = report?.tools.find((t) => t.name === "ffmpeg");
  const ffprobe = report?.tools.find((t) => t.name === "ffprobe");
  const hw = (report?.encoders ?? []).filter((e) => e.startsWith("h264_"));
  return (
    <>
      <Card
        testId="encoder-card"
        title="ffmpeg"
        description="Every cut, crop and caption is done by the bundled ffmpeg."
        actions={<CheckAgain />}
      >
        <Row label="Version">
          {report === null ? (
            <Waiting />
          ) : ffmpeg?.present === true ? (
            `${ffmpeg.version ?? "unknown"} (ffprobe ${ffprobe?.present === true ? (ffprobe.version ?? "unknown") : "missing"})`
          ) : (
            "Missing"
          )}
        </Row>
        <Row label="Captions">
          {report === null ? <Waiting /> : <YesNo value={report.ffmpeg.subtitles} yes="libass" />}
        </Row>
        <Row label="H.264">
          {report === null ? <Waiting /> : <YesNo value={report.ffmpeg.libx264} yes="libx264" />}
        </Row>
      </Card>
      <Card
        testId="encoders-card"
        title="Encoders"
        description="A short test encode picks the fastest one that works here."
        actions={<ComesIn spec={4} />}
      >
        <div className="flex flex-wrap gap-1.5 px-5 py-4">
          {report === null ? (
            <Waiting />
          ) : report.encoders.length === 0 ? (
            <span className="text-[14px] text-secondary">None found.</span>
          ) : (
            report.encoders.map((e) => (
              <span
                key={e}
                title={hw.includes(e) ? "Hardware" : undefined}
                className={`rounded-full px-2.5 py-0.5 font-mono text-[12px] ${hw.includes(e) ? "bg-unread/10 text-[#93b8fb]" : "bg-bubble-user text-secondary"}`}
              >
                {e}
              </span>
            ))
          )}
        </div>
      </Card>
    </>
  );
}

function StorageSection() {
  const paths = useAppFacts((s) => s.paths);
  const count = useStreams((s) => s.streams.length);
  const info = useAppFacts((s) => s.info);
  const folderApp = info?.platform === "win32" ? "Explorer" : "Finder";
  return (
    <>
      <Card
        testId="storage-card"
        title="Folders"
        description="Settings, profile and models live here. Nothing is written next to your videos."
        actions={
          paths !== null ? (
            <Button
              size="sm"
              variant="ghost"
              data-testid="open-data-folder"
              onClick={() => {
                window.alcyo
                  .invoke("shell:openDataFolder", {})
                  .catch(() =>
                    toast("Couldn't open the data folder", "Copy the path and open it by hand."),
                  );
              }}
            >
              Show in {folderApp}
            </Button>
          ) : undefined
        }
      >
        <Row label="Data" mono aside={paths ? <CopyButton text={paths.userData} /> : undefined}>
          <span data-testid="data-folder">{paths?.userData ?? "…"}</span>
        </Row>
        <Row label="Models" mono aside={paths ? <CopyButton text={paths.models} /> : undefined}>
          {paths?.models ?? "…"}
        </Row>
        <Row label="Tools" mono aside={paths ? <CopyButton text={paths.bin} /> : undefined}>
          {paths?.bin ?? "…"}
        </Row>
      </Card>
      <Card
        testId="streams-card"
        title="Streams"
        description="Each stream is a .alcyo folder. Recordings stay where they are."
      >
        <Row label="Folder" mono aside={paths ? <CopyButton text={paths.streams} /> : undefined}>
          <span data-testid="streams-folder">{paths?.streams ?? "…"}</span>
        </Row>
        <Row label="Streams">
          <span className="text-secondary">{count === 0 ? "None yet" : String(count)}</span>
        </Row>
      </Card>
    </>
  );
}

function osName(platform: string): string {
  return platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform;
}

function Disclosure({
  title,
  children,
  testId,
}: {
  title: string;
  children: string;
  testId?: string;
}) {
  return (
    <details className="rounded-2xl bg-card ring-1 ring-hairline">
      <summary className="cursor-pointer list-none rounded-2xl px-5 py-3.5 text-[14px] outline-none hover:bg-bubble-claude focus-visible:ring-2 focus-visible:ring-unread">
        {title}
      </summary>
      <pre
        data-testid={testId}
        className="max-h-[480px] overflow-y-auto border-t border-hairline px-5 py-4 font-sans text-[13px] whitespace-pre-wrap text-secondary select-text"
      >
        {children}
      </pre>
    </details>
  );
}

function DownloaderCard() {
  const [info, setInfo] = useState<DownloaderInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    window.alcyo.invoke("downloader:info", {}).then(setInfo, () => undefined);
  }, []);

  const act = (channel: "downloader:update" | "downloader:useBundled") => {
    setBusy(true);
    setNote(null);
    window.alcyo
      .invoke(channel, {})
      .then(
        (next) => {
          setInfo(next);
          setNote(next.note ?? null);
        },
        (error: unknown) => setNote(plainError(error)),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Card
      testId="downloader-card"
      title="Downloader"
      description="yt-dlp downloads links. Sites change often, so a newer version may be needed."
      actions={
        <>
          {info?.updated === true && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              data-testid="downloader-bundled"
              onClick={() => act("downloader:useBundled")}
            >
              Use the bundled version
            </Button>
          )}
          <Button
            size="sm"
            disabled={busy || info === null}
            data-testid="downloader-update"
            onClick={() => act("downloader:update")}
          >
            {busy && <Spinner size={12} />}
            Update downloader
          </Button>
        </>
      }
    >
      <Row label="In use">
        <span data-testid="downloader-version">
          {info === null
            ? "Checking…"
            : `${info.version ?? "Unknown"}${info.updated ? " (updated)" : " (bundled)"}`}
        </span>
      </Row>
      {info?.updated === true && <Row label="Bundled">{info.bundled ?? "Unknown"}</Row>}
      {note !== null && (
        <p
          data-testid="downloader-note"
          className="border-t border-hairline px-5 py-3 text-[14px] text-secondary"
        >
          {note}
        </p>
      )}
    </Card>
  );
}

function AboutSection() {
  const info = useAppFacts((s) => s.info);
  const report = useSetup((s) => s.report);
  return (
    <>
      <div className="flex items-center gap-4 px-1 py-2">
        <AppMark size={48} />
        <div className="min-w-0">
          <h3 className="text-body font-semibold">Alcyo Shorts</h3>
          <p data-testid="app-version" className="text-[14px] text-secondary select-text">
            {info === null ? "Alcyo Shorts" : `Version ${info.version}`}
          </p>
        </div>
      </div>
      <Card title="This computer" testId="about-tools">
        <Row label="System">
          {info === null
            ? "…"
            : `${osName(info.platform)} · ${info.arch} · Electron ${info.electron}`}
        </Row>
        {report === null ? (
          <Row label="Tools">
            <Waiting />
          </Row>
        ) : (
          report.tools.map((t) => (
            <Row key={t.name} label={t.name}>
              {t.present ? (t.version ?? "Bundled") : <span className="text-bad">Missing</span>}
            </Row>
          ))
        )}
      </Card>
      <DownloaderCard />
      <Disclosure title="License (MIT)">{license}</Disclosure>
      <Disclosure title="Third-party notices" testId="notices">
        {notices}
      </Disclosure>
    </>
  );
}

const CONTENT: Record<SectionId, () => ReactNode> = {
  profile: ProfileSection,
  claude: ClaudeSection,
  models: ModelsSection,
  encoder: EncoderSection,
  storage: StorageSection,
  about: AboutSection,
};

export function SettingsPage({ section }: { section: SectionId }) {
  const meta = SECTIONS.find((s) => s.id === section)!;
  usePageTitle(`Settings · ${meta.label}`);
  const back = useBack();
  useEscape("screen", true, back);
  const loadFacts = useAppFacts((s) => s.load);
  const { report, loading, load } = useSetup();
  useEffect(() => {
    loadFacts();
    if (report === null && !loading) void load();
  }, [loadFacts, report, loading, load]);
  const Content = CONTENT[section];

  const groups = [...new Set(SECTIONS.map((s) => s.group))];

  return (
    <div data-testid="settings" className="flex h-full">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-hairline bg-sidebar">
        {/* The macOS traffic lights sit in this strip. */}
        <div className={`drag flex h-[52px] shrink-0 items-center ${isMac ? "pl-[80px]" : "pl-2"}`}>
          <BackButton />
        </div>
        <h1 data-testid="screen-title" className="px-4 pt-1 pb-3 text-[15px] font-semibold">
          Settings
        </h1>
        <nav aria-label="Settings sections" className="space-y-4 overflow-y-auto px-2 pb-4">
          {groups.map((group) => (
            <div key={group}>
              <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-tertiary uppercase">
                {group}
              </p>
              <div className="space-y-px">
                {SECTIONS.filter((s) => s.group === group).map((s) => {
                  const Icon = s.icon;
                  return (
                    <Link
                      key={s.id}
                      {...sectionLink(s.id)}
                      // Sections replace each other in history, so Back leaves Settings.
                      replace
                      data-testid={`section-${s.id}`}
                      aria-current={s.id === section ? "page" : undefined}
                      className={`flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-unread ${
                        s.id === section
                          ? "bg-white/[0.07] font-medium text-text"
                          : "text-secondary hover:bg-white/[0.04] hover:text-text"
                      }`}
                    >
                      <Icon size={16} />
                      {s.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="drag flex h-[52px] shrink-0 items-center border-b border-hairline px-6">
          <h2 className="text-[15px] font-semibold">{meta.label}</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            key={section}
            data-testid={`settings-${section}`}
            className="fade-in mx-auto w-full max-w-4xl space-y-5 px-6 pt-6 pb-12"
          >
            <Content />
          </div>
        </div>
      </div>
    </div>
  );
}
