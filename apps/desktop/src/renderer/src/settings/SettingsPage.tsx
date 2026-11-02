// Settings (plan section 4): Profile, Claude, Models, Encoder, Storage, About.
// Full window: the settings nav takes the sidebar's place, and Back returns to
// the chat. Every value comes from main; unbuilt parts carry a quiet "Soon".
import type { SetupCheck, SetupReport } from "@alcyo/ipc";
import { Link } from "@tanstack/react-router";
import { type ComponentType, type ReactNode, useEffect } from "react";
import license from "../../../../../../LICENSE?raw";
import notices from "../../../../../../THIRD_PARTY_NOTICES.md?raw";
import { BackButton } from "../nav/BackButton";
import { isMac, useBack, usePageTitle } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { openIssues, useAppFacts, useSetup } from "../setup/store";
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
  { id: "claude", label: "Claude", icon: ChatIcon },
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
      <Card
        testId="profile-empty"
        title="No creator profile yet"
        description="Claude asks a few questions about your streams and your shorts. The answers become your profile, which goes into every prompt as text."
        actions={<ComesIn spec={7} />}
      />
      <Card
        title="Past shorts and templates"
        description="Add shorts you've posted and caption templates. Only their measurements are kept."
        actions={<ComesIn spec={7} />}
      />
    </>
  );
}

function ClaudeSection() {
  const report = useSetup((s) => s.report);
  const found = check(report, "claude");
  const auth = check(report, "claude-auth");
  const via = {
    saved: "saved path",
    "known-folder": "standard folder",
    "login-shell": "login shell",
    where: "PATH",
    none: "",
  } as const;
  return (
    <>
      <Card
        testId="claude-card"
        title="Claude Code"
        description="Alcyo runs your own claude command, so your Claude plan pays for it."
        actions={<CheckAgain />}
      >
        <Row label="Status">
          {report === null ? (
            <Waiting />
          ) : (
            <span className="flex items-center gap-2">
              <YesNo value={report.claude.path !== null} yes="Found" no="Not found" />
              {report.claude.path !== null && (
                <span className="text-[13px] text-tertiary">in a {via[report.claude.via]}</span>
              )}
            </span>
          )}
        </Row>
        <Row
          label="Path"
          mono
          aside={report?.claude.path != null ? <CopyButton text={report.claude.path} /> : undefined}
        >
          <span data-testid="claude-path">
            {report === null ? "…" : (report.claude.path ?? "—")}
          </span>
        </Row>
        <Row label="Version">{report === null ? "…" : (report.claude.version ?? "—")}</Row>
        <Row label="Signed in">
          {report === null ? (
            <Waiting />
          ) : report.claude.signedIn === null ? (
            <span className="text-secondary">Checked once Claude Code is found</span>
          ) : (
            <YesNo value={report.claude.signedIn} />
          )}
        </Row>
        <FixLine c={found} />
        <FixLine c={auth} />
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
        <Row label="Locate claude" aside={<ComesIn spec={5} />}>
          <span className="text-secondary">For installs in an unusual folder</span>
        </Row>
        <Row label="API key backup" aside={<ComesIn spec={5} />}>
          <span className="text-secondary">Used only if Claude Code is missing</span>
        </Row>
      </Card>
      <Note>
        Claude sees transcript text and your profile, never video or audio. Alcyo never offers a
        Claude login and never reads or stores your Claude credentials.
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
        <Row label="Model">
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
        The model downloads once, on first run. Silero skips silence so transcripts are faster.
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
        actions={<ComesIn spec={3} />}
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
        title="Streams"
        description="Each stream is a .alcyo folder in a place you choose."
        actions={<ComesIn spec={4} />}
      />
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
