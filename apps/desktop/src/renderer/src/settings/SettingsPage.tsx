// Settings (plan section 4): Profile, Claude, Models, Encoder, Storage, About.
// Every value comes from main; anything not built yet says which spec adds it.
import type { SetupCheck, SetupReport } from "@alcyo/ipc";
import { Link } from "@tanstack/react-router";
import { type ComponentType, type ReactNode, useEffect } from "react";
import license from "../../../../../../LICENSE?raw";
import notices from "../../../../../../THIRD_PARTY_NOTICES.md?raw";
import { usePageTitle, useBack } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { ScreenHeader } from "../nav/ScreenHeader";
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
const SECTIONS: Array<{ id: SectionId; label: string; icon: IconC; blurb: string }> = [
  { id: "profile", label: "Profile", icon: UserIcon, blurb: "Your style, for every prompt" },
  { id: "claude", label: "Claude", icon: ChatIcon, blurb: "Claude Code and sign-in" },
  { id: "models", label: "Models", icon: WaveIcon, blurb: "Transcription models" },
  { id: "encoder", label: "Encoder", icon: CpuIcon, blurb: "ffmpeg and video encoders" },
  { id: "storage", label: "Storage", icon: FolderIcon, blurb: "Where Alcyo keeps things" },
  { id: "about", label: "About", icon: InfoIcon, blurb: "Version and licenses" },
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
    <Button size="sm" onClick={() => void load(true)} disabled={loading} data-testid="check-again">
      {loading ? <Spinner size={12} /> : <RefreshIcon size={14} />}
      Check again
    </Button>
  );
}

function SetupBanner() {
  const report = useSetup((s) => s.report);
  if (report === null || report.complete) return null;
  const n = openIssues(report);
  return (
    <div className="flex items-center gap-4 rounded-[20px] bg-warn/8 px-5 py-4 ring-1 ring-warn/25">
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium">Setup isn&apos;t finished</p>
        <p className="text-[14px] text-secondary">
          {n} {n === 1 ? "check needs" : "checks need"} attention before Alcyo can make shorts.
        </p>
      </div>
      <ButtonLink to="/setup" size="sm" variant="primary">
        Open Setup
      </ButtonLink>
    </div>
  );
}

function ProfileSection() {
  const fields = [
    ["Streams and audience", "What you stream and who watches"],
    ["Good moments", "Funny, skill, rage, wholesome, story, info, close calls"],
    ["Short length", "15 to 60 s until you pick a range"],
    ["Titles", "Your title rules and examples"],
    ["Keep out", "Words, topics or people to avoid"],
    ["Platforms", "TikTok, YouTube Shorts, Reels: sets safe areas"],
    ["Caption look", "Bold pop, Clean, or your template"],
  ] as const;
  return (
    <>
      <SetupBanner />
      <Card
        testId="profile-empty"
        title="No creator profile yet"
        description="After setup, Claude asks you 5 to 8 questions about your streams and your shorts, and the app measures a few shorts you've already posted. The result is your profile. It goes into every prompt as text, and you can edit it here."
        actions={<ComesIn spec={7} />}
      >
        {fields.map(([label, hint]) => (
          <Row key={label} label={label}>
            <span className="text-tertiary">{hint}</span>
          </Row>
        ))}
      </Card>
      <Card
        title="Past shorts and templates"
        description="Drop in up to 50 shorts you've posted, and any Alcyo template or .ass caption file. Only their measurements are kept; the videos are never copied."
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
    saved: "Saved path",
    "known-folder": "Standard install folder",
    "login-shell": "Your login shell",
    where: "PATH (where.exe)",
    none: "Not found",
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
            <YesNo value={report.claude.path !== null} yes="Found" no="Not found" />
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
        <Row label="Found through">{report === null ? "…" : via[report.claude.via]}</Row>
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
      <Card
        title="Setup checks"
        description="Claude Code, sign-in, the bundled tools and models, with how to fix anything missing."
        actions={
          <ButtonLink to="/setup" size="sm" data-testid="open-setup">
            Open Setup
          </ButtonLink>
        }
      />
      <Card
        title="What Claude sees"
        description="Numbered transcript lines and your profile, as text. Never video, audio or images. Claude answers with line ids and one action from a fixed list; the app checks every answer."
      />
      <Card
        title="Locate claude by hand"
        description="For installs in an unusual folder. The path is saved and tried first."
        actions={<ComesIn spec={5} />}
      />
      <Card
        title="Backup: Anthropic API key"
        description="Used only if you choose it or Claude Code is missing. Stored encrypted on this computer."
        actions={<ComesIn spec={5} />}
      />
      <p className="px-1 text-[13px] text-secondary">
        Alcyo never offers a Claude login and never reads or stores your Claude credentials.
      </p>
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
        description="whisper.cpp turns speech into words with timings, on this computer."
        actions={<CheckAgain />}
      >
        <Row label="Model">
          {report === null ? <Waiting /> : <span>{report.whisperModel.name}</span>}
        </Row>
        <Row label="Downloaded">
          {report === null ? (
            <Waiting />
          ) : report.whisperModel.present ? (
            <YesNo value />
          ) : (
            <span className="flex items-center gap-2">
              <StateBadge state="pending">Not yet</StateBadge>
              <ComesIn spec={5} />
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
      </Card>
      <Card
        title="Voice activity detection"
        description="Silero VAD skips silence, so transcription is faster and has fewer made-up words."
      >
        <Row label="Status">
          {vad === undefined ? <Waiting /> : <StateBadge state={vad.state} />}
        </Row>
        <Row label="File" mono>
          {vad?.detail.replace(/^Bundled: /, "") ?? "…"}
        </Row>
      </Card>
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
        description="Every cut, crop and caption in a render is done by the bundled ffmpeg."
        actions={<CheckAgain />}
      >
        <Row label="ffmpeg">
          {report === null ? (
            <Waiting />
          ) : ffmpeg?.present === true ? (
            `Version ${ffmpeg.version ?? "unknown"}`
          ) : (
            "Missing"
          )}
        </Row>
        <Row label="ffprobe">
          {report === null
            ? "…"
            : ffprobe?.present === true
              ? `Version ${ffprobe.version ?? "unknown"}`
              : "Missing"}
        </Row>
        <Row label="Captions (libass)">
          {report === null ? <Waiting /> : <YesNo value={report.ffmpeg.subtitles} />}
        </Row>
        <Row label="libx264">
          {report === null ? <Waiting /> : <YesNo value={report.ffmpeg.libx264} />}
        </Row>
        <Row label="Path" mono>
          {ffmpeg?.path ?? "…"}
        </Row>
      </Card>
      <Card
        testId="encoders-card"
        title="H.264 encoders in this build"
        description="A 1-second test encode will pick the fastest one that works on this computer, with libx264 as the fallback."
        actions={<ComesIn spec={3} />}
      >
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {report === null ? (
            <Waiting />
          ) : report.encoders.length === 0 ? (
            <span className="text-[14px] text-secondary">None found.</span>
          ) : (
            report.encoders.map((e) => (
              <span
                key={e}
                className={`rounded-full px-3 py-1 font-mono text-[12px] ring-1 ring-hairline ${hw.includes(e) ? "bg-unread/10 text-[#93b8fb]" : "bg-bubble-user"}`}
              >
                {e}
                {hw.includes(e) ? " · hardware" : ""}
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
        description="Alcyo keeps its settings, profile and models here. Nothing is written next to your videos."
      >
        <Row
          label="Data folder"
          mono
          aside={
            paths !== null ? (
              <>
                <CopyButton text={paths.userData} />
                <Button
                  size="sm"
                  data-testid="open-data-folder"
                  onClick={() => {
                    window.alcyo
                      .invoke("shell:openDataFolder", {})
                      .catch(() =>
                        toast(
                          "Couldn't open the data folder",
                          "Copy the path and open it by hand.",
                        ),
                      );
                  }}
                >
                  Show in {folderApp}
                </Button>
              </>
            ) : undefined
          }
        >
          <span data-testid="data-folder">{paths?.userData ?? "…"}</span>
        </Row>
        <Row label="Models" mono aside={paths ? <CopyButton text={paths.models} /> : undefined}>
          {paths?.models ?? "…"}
        </Row>
        <Row label="Bundled tools" mono aside={paths ? <CopyButton text={paths.bin} /> : undefined}>
          {paths?.bin ?? "…"}
        </Row>
      </Card>
      <Card
        title="Streams"
        description="Each stream is a folder ending in .alcyo, in a place you choose. The app keeps a list of them so links open the right folder."
        actions={<ComesIn spec={4} />}
      >
        <Row label="Streams">
          <span className="text-secondary">None yet</span>
        </Row>
      </Card>
    </>
  );
}

function osName(platform: string): string {
  return platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform;
}

function AboutSection() {
  const info = useAppFacts((s) => s.info);
  const report = useSetup((s) => s.report);
  return (
    <>
      <section className="flex items-center gap-5 rounded-[20px] bg-card px-5 py-5 ring-1 ring-hairline">
        <AppMark size={64} />
        <div className="min-w-0">
          <h3 className="text-[20px] font-semibold">Alcyo Shorts</h3>
          <p data-testid="app-version" className="text-small text-secondary select-text">
            {info === null ? "Alcyo Shorts" : `Version ${info.version}`}
          </p>
          <p className="mt-1 text-[14px] text-secondary">
            Turns a long stream into captioned 9:16 shorts, on your own computer.
          </p>
        </div>
      </section>
      <Card title="This computer">
        <Row label="System">{info === null ? "…" : `${osName(info.platform)} · ${info.arch}`}</Row>
        <Row label="Electron">{info?.electron ?? "…"}</Row>
        <Row label="Chromium">{info?.chrome ?? "…"}</Row>
        <Row label="Node">{info?.node ?? "…"}</Row>
      </Card>
      <Card title="Bundled tools" testId="about-tools">
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
      <details className="group rounded-[20px] bg-card ring-1 ring-hairline">
        <summary className="cursor-pointer list-none rounded-[20px] px-5 py-4 text-small font-semibold outline-none hover:bg-bubble-claude focus-visible:ring-2 focus-visible:ring-unread">
          License (MIT)
        </summary>
        <pre className="border-t border-hairline px-5 py-4 font-sans text-[13px] whitespace-pre-wrap text-secondary select-text">
          {license}
        </pre>
      </details>
      <details className="group rounded-[20px] bg-card ring-1 ring-hairline">
        <summary className="cursor-pointer list-none rounded-[20px] px-5 py-4 text-small font-semibold outline-none hover:bg-bubble-claude focus-visible:ring-2 focus-visible:ring-unread">
          Third-party notices
        </summary>
        <pre
          data-testid="notices"
          className="max-h-[480px] overflow-y-auto border-t border-hairline px-5 py-4 font-sans text-[13px] whitespace-pre-wrap text-secondary select-text"
        >
          {notices}
        </pre>
      </details>
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
    <div data-testid="settings" className="flex h-full flex-col">
      <ScreenHeader title="Settings" subtitle={meta.label} />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="w-60 shrink-0 space-y-0.5 overflow-y-auto border-r border-hairline p-3"
        >
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.id}
                {...sectionLink(s.id)}
                data-testid={`section-${s.id}`}
                aria-current={s.id === section ? "page" : undefined}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-unread ${
                  s.id === section
                    ? "bg-bubble-user text-text"
                    : "text-secondary hover:bg-bubble-claude hover:text-text active:bg-bubble-user"
                }`}
              >
                <Icon size={18} />
                <span className="min-w-0">
                  <span className="block text-small leading-tight">{s.label}</span>
                  <span className="block truncate text-[12px] text-tertiary">{s.blurb}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div
            key={section}
            data-testid={`settings-${section}`}
            className="fade-in mx-auto w-full max-w-2xl space-y-4 px-8 pt-8 pb-12"
          >
            <h2 className="text-[22px] font-semibold tracking-tight">{meta.label}</h2>
            <Content />
          </div>
        </div>
      </div>
    </div>
  );
}
