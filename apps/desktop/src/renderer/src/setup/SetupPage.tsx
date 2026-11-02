// First-run Setup (plan section 3 step 1). Full window, no sidebar.
import type { CheckId, SetupCheck } from "@alcyo/ipc";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { usePageTitle } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { ScreenHeader } from "../nav/ScreenHeader";
import { AppMark } from "../ui/AppMark";
import { Button } from "../ui/Button";
import { RefreshIcon, ShieldIcon } from "../ui/icons";
import { CopyButton, Spinner, StateIcon } from "../ui/parts";
import { openIssues, useSetup } from "./store";

const GROUPS: Array<{ title: string; ids: CheckId[] }> = [
  { title: "Claude", ids: ["claude", "claude-auth"] },
  {
    title: "Bundled tools",
    ids: ["ffmpeg", "ffprobe", "whisper-cli", "yt-dlp", "vad", "ffmpeg-features"],
  },
  { title: "Models", ids: ["whisper-model"] },
];

function CheckRow({ check }: { check: SetupCheck }) {
  return (
    <li
      data-testid={`check-${check.id}`}
      data-state={check.state}
      className="flex gap-4 border-b border-hairline px-5 py-3.5 last:border-b-0"
    >
      <StateIcon state={check.state} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-small font-medium">{check.label}</span>
          {!check.required && <span className="text-[12px] text-tertiary">Optional for now</span>}
        </div>
        <p className="mt-0.5 truncate text-[13px] text-secondary select-text" title={check.detail}>
          {check.detail}
        </p>
        {check.fix !== null && (
          <div className="mt-2 flex items-start gap-3">
            <p
              data-testid="fix"
              className={`min-w-0 flex-1 pt-1 text-[14px] ${check.state === "fail" ? "text-[#fca5a5]" : "text-[#fcd34d]"}`}
            >
              {check.fix}
            </p>
            {check.command !== null && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bubble-user py-0.5 pr-0.5 pl-3 font-mono text-[12px] whitespace-nowrap">
                {check.command}
                <CopyButton text={check.command} label="Copy command" />
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function LoadingRows() {
  return (
    <div className="flex items-center gap-3 px-5 py-6 text-small text-secondary">
      <Spinner />
      Checking Claude Code and the bundled tools. The first check can take a few seconds.
    </div>
  );
}

export function SetupPage() {
  usePageTitle("Setup");
  const router = useRouter();
  const { report, loading, error, load, skip } = useSetup();

  useEffect(() => {
    if (report === null && !loading) void load();
  }, [report, loading, load]);

  const leave = () => {
    if (report?.complete !== true) skip();
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: "/" });
  };
  useEscape("screen", true, leave);

  const issues = report === null ? 0 : openIssues(report);
  const total = report?.checks.filter((c) => c.required).length ?? 0;
  const byId = new Map(report?.checks.map((c) => [c.id, c]) ?? []);

  return (
    <div data-testid="setup" className="flex h-full flex-col bg-bg">
      <ScreenHeader
        fullWindow
        title="Setup"
        subtitle="Check this computer before the first stream"
        onBack={leave}
        backLabel={
          router.history.canGoBack() ? "Back" : report?.complete === true ? "Home" : "Skip for now"
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-8 pt-10 pb-8">
          <div className="flex items-center gap-4">
            <AppMark size={56} />
            <div>
              <h2 className="text-[24px] font-semibold tracking-tight">Set up Alcyo Shorts</h2>
              <p className="mt-1 text-small text-secondary">
                Everything runs on this computer. Alcyo needs Claude Code, signed in, and the tools
                that ship with the app.
              </p>
            </div>
          </div>

          {report !== null && (
            <div className="mt-8" data-testid="setup-summary">
              <div className="flex items-baseline justify-between text-[14px]">
                <span className={issues === 0 ? "text-ok" : "text-text"}>
                  {issues === 0
                    ? "Everything Alcyo needs is ready."
                    : `${issues} ${issues === 1 ? "check needs" : "checks need"} attention.`}
                </span>
                <span className="text-secondary">
                  {total - issues} of {total} ready
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bubble-user">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${issues === 0 ? "bg-ok" : "bg-unread"}`}
                  style={{ width: `${total === 0 ? 0 : ((total - issues) / total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {error !== null && (
            <p
              role="alert"
              className="mt-6 rounded-2xl bg-bad/10 px-4 py-3 text-small text-[#fca5a5]"
            >
              {error}
            </p>
          )}

          <div className="mt-6 space-y-5">
            {GROUPS.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3 className="mb-2 px-1 text-[13px] font-semibold tracking-wide text-secondary uppercase">
                  {group.title}
                </h3>
                <ul className="overflow-hidden rounded-[20px] bg-card ring-1 ring-hairline">
                  {report === null ? (
                    <LoadingRows />
                  ) : (
                    group.ids.flatMap((id) => {
                      const check = byId.get(id);
                      return check === undefined ? [] : [<CheckRow key={id} check={check} />];
                    })
                  )}
                </ul>
              </section>
            ))}
          </div>

          <p className="mt-6 flex items-start gap-2 px-1 text-[13px] text-secondary">
            <ShieldIcon size={16} className="mt-0.5 shrink-0" />
            Alcyo never asks for your Claude login and never reads it. Sign-in stays in Claude Code,
            and only transcript text goes to Claude.
          </p>
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-hairline bg-sidebar px-8 py-4">
        <span className="flex-1 text-[13px] text-tertiary">
          {report === null
            ? "Checking…"
            : `Checked at ${new Date(report.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
        </span>
        <Button
          data-testid="check-again"
          onClick={() => void load(true)}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? <Spinner size={14} /> : <RefreshIcon size={16} />}
          Check again
        </Button>
        {report?.complete !== true && (
          <Button data-testid="skip-setup" variant="ghost" onClick={leave}>
            Skip for now
          </Button>
        )}
        <Button
          data-testid="continue"
          variant="primary"
          disabled={report?.complete !== true}
          onClick={() => void router.navigate({ to: "/", replace: true })}
        >
          Continue
        </Button>
      </footer>
    </div>
  );
}
