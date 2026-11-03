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
const SECTIONS: Array<{ id: SectionId; label: string; icon: IconC }> = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "claude", label: "Agent", icon: ChatIcon },
  { id: "models", label: "Models", icon: WaveIcon },
  { id: "encoder", label: "Encoder", icon: CpuIcon },
  { id: "storage", label: "Storage", icon: FolderIcon },
  { id: "about", label: "About", icon: InfoIcon },
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

function FixLine({ c }: { c: SetupCheck | undefined }) {
  if (c?.fix == null || c.state === "pass") return null;
  return <p className="border-t border-hairline px-5 py-3 text-[14px] text-[#fcd34d]">{c.fix}</p>;
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

function agentLine(report: SetupReport | null, id: LocalAgentId): string {
  if (report === null) return "…";
  const hit = report.agents.find((agent) => agent.id === id);
  const version = hit?.version == null ? "" : `, version ${hit.version}`;
  if (report.chosen?.id === id) return `Signed in${version}. Alcyo will use this one.`;
  if (hit === undefined || hit.path === null) {
    return hit?.problem === "cmd-shim" ? "Only a command shim is installed." : "Not found";
  }
  return hit.signedIn === true ? `Signed in${version}` : `Found${version}, not signed in`;
}

const AGENT_CHECK: Record<LocalAgentId, SetupCheck["id"]> = {
  claude: "claude",
  grok: "agent-grok",
  codex: "agent-codex",
};

function AgentTools() {
  const report = useSetup((s) => s.report);
  const load = useSetup((s) => s.load);
  const [busy, setBusy] = useState<LocalAgentId | null>(null);
  const ids: LocalAgentId[] = ["claude", "grok", "codex"];

  return (
    <>
      {ids.map((id) => {
        const path = report?.agents.find((agent) => agent.id === id)?.path ?? null;
        const row = check(report, AGENT_CHECK[id]);
        return (
          <div key={id} data-testid={`agent-${id}`}>
            <Row
              label={AGENT_LABEL[id]}
              aside={
                <>
                  {path !== null && <CopyButton text={path} />}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    data-testid={`locate-${id}`}
                    onClick={() => {
                      setBusy(id);
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
                          (error: unknown) =>
                            toast("Couldn't open the file dialog", messageOf(error)),
                        )
                        .finally(() => setBusy(null));
                    }}
                  >
                    {busy === id && <Spinner size={12} />}
                    Locate
                  </Button>
                </>
              }
            >
              <span className="block text-secondary">{agentLine(report, id)}</span>
              {path !== null && (
                <span
                  data-testid={`${id}-path`}
                  className="mt-0.5 block font-mono text-[13px] text-tertiary"
                >
                  {path}
                </span>
              )}
            </Row>
            {row?.state === "fail" && <FixLine c={row} />}
          </div>
        );
      })}
    </>
  );
}

function ApiKeyCard() {
  const report = useSetup((s) => s.report);
  const load = useSetup((s) => s.load);
  const present = report?.apiKey.present === true;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = key.trim();

  return (
    <Card
      testId="api-key-card"
      title="API key backup"
      description="Used only when no coding agent is signed in. The key stays on this computer."
    >
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
          className="h-9 min-w-0 flex-1 rounded-full bg-bubble-claude px-4 text-small outline-none placeholder:text-tertiary focus-visible:ring-2 focus-visible:ring-unread"
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
      <p className="border-t border-hairline px-5 py-3 text-[13px] text-tertiary">
        {report === null
          ? "…"
          : present
            ? "A key is saved. Alcyo never shows it again."
            : "No key saved."}
      </p>
    </Card>
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
  const summary = check(report, "agent");
  return (
    <>
      <Card
        testId="claude-card"
        title="Coding agent"
        description="Alcyo runs Claude Code, Grok or Codex on this computer. Whichever is signed in answers."
        actions={<CheckAgain />}
      >
        <Row label="Will use">
          {report === null
            ? "…"
            : report.chosen !== null
              ? AGENT_LABEL[report.chosen.id]
              : report.apiKey.present
                ? "Saved API key"
                : "None yet"}
        </Row>
        <FixLine c={summary} />
        <AgentTools />
      </Card>
      <Card title="More">
        <Row
          label="Setup checks"
          aside={
            <ButtonLink to="/setup" size="sm" variant="ghost" data-testid="open-setup">
              Open Setup
            </ButtonLink>
          }
        >
          <span className="text-secondary">Every tool and model, with fixes</span>
        </Row>
      </Card>
      <ApiKeyCard />
      <Note>
        The agent sees transcript text and your profile, never video or audio. Alcyo never offers a
        login and never reads or stores an agent's credentials. A backup API key is encrypted by the
        operating system.
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
        <Row label="File" mono>
          {report?.whisperModel.path ?? "…"}
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
        <Row label="Path" mono>
          {ffmpeg?.path ?? "…"}
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

  return (
    <div data-testid="settings" className="flex h-full">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-hairline bg-sidebar">
        {/* The macOS traffic lights sit in this strip. */}
        <div className={`drag flex h-[52px] shrink-0 items-center ${isMac ? "pl-[84px]" : "pl-3"}`}>
          <BackButton />
        </div>
        <h1 data-testid="screen-title" className="px-5 pt-3 pb-3 text-[20px] font-semibold">
          Settings
        </h1>
        <nav aria-label="Settings sections" className="space-y-0.5 overflow-y-auto px-2">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.id}
                {...sectionLink(s.id)}
                // Sections replace each other in history, so Back leaves Settings.
                replace
                data-testid={`section-${s.id}`}
                aria-current={s.id === section ? "page" : undefined}
                className={`flex h-9 items-center gap-3 rounded-xl px-3 text-[15px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-unread ${
                  s.id === section
                    ? "bg-bubble-claude text-text"
                    : "text-secondary hover:bg-bubble-claude/60 hover:text-text"
                }`}
              >
                <Icon size={17} />
                {s.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="drag sticky top-0 z-10 h-[52px] bg-bg/80 backdrop-blur" aria-hidden />
        <div
          key={section}
          data-testid={`settings-${section}`}
          className="fade-in mx-auto w-full max-w-[640px] space-y-4 px-10 pt-2 pb-16"
        >
          <h2 className="pb-1 text-[22px] font-semibold tracking-tight">{meta.label}</h2>
          <Content />
        </div>
      </div>
    </div>
  );
}
