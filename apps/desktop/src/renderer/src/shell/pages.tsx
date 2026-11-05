import { BAD_LINK_MESSAGE } from "@alcyo/schema";
import { Link, useRouter } from "@tanstack/react-router";
import {
  type ClipboardEvent,
  type ComponentProps,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useBack, usePageTitle, useUi } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { Button, ButtonLink, IconButton } from "../ui/Button";
import {
  AlertIcon,
  ArrowUpIcon,
  CloseIcon,
  FileIcon,
  FilmIcon,
  LinkIcon,
  PlusIcon,
  UserIcon,
} from "../ui/icons";
import { useProfile } from "../profile/store";
import { openIssues, useSetup } from "../setup/store";
import { ModelPicker } from "../streams/ModelPicker";
import { chooseFile, plainError } from "../streams/store";
import { toast, useToasts } from "../ui/toast";

const URL_RE = /^\s*https?:\/\/\S+\s*$/i;

export function looksLikeUrl(text: string): boolean {
  return URL_RE.test(text);
}

/** The bundled demo stream: main copies it in the first time, then we open it. */
export function useOpenDemo(): () => void {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return () => {
    if (busy) return;
    setBusy(true);
    window.alcyo
      .invoke("demo:open", {})
      .then(
        ({ stream }) =>
          void router.navigate({ to: "/s/$streamId", params: { streamId: stream.streamId } }),
        (error: unknown) => toast("Couldn't open the demo", plainError(error)),
      )
      .finally(() => setBusy(false));
  };
}

/** The top bar of a thread: the name on the left, actions on the right. It
 *  drags the window, and content scrolls under it, never behind it. */
export function ThreadHeader({
  label,
  meta,
  actions,
}: {
  label: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="drag relative z-[1] flex h-[52px] shrink-0 items-center gap-3 border-b border-hairline px-5">
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <h1
          data-testid="thread-header"
          className="truncate text-[14px] leading-5 font-semibold tracking-[-0.01em]"
        >
          {label}
        </h1>
        {meta !== undefined && (
          <span className="shrink-0 text-[12px] text-tertiary tabular-nums">{meta}</span>
        )}
      </div>
      {actions !== undefined && (
        <div className="no-drag flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

function AttachMenu({
  onClose,
  onLink,
  onFile,
}: {
  onClose: () => void;
  onLink: () => void;
  onFile: () => void;
}) {
  useEscape("overlay", true, onClose);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] outline-none hover:bg-white/[0.06] focus-visible:bg-white/[0.06] active:bg-white/[0.09]";
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <div
        role="menu"
        data-overlay
        data-testid="attach-menu"
        className="fade-in absolute bottom-full left-2 z-30 mb-2 w-60 rounded-xl border border-white/10 bg-popover p-1 shadow-[0_18px_44px_-18px_rgba(0,0,0,0.8)] backdrop-blur-xl"
      >
        <button
          ref={first}
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onClose();
            onLink();
          }}
        >
          <LinkIcon size={17} className="text-secondary" />
          Paste a stream or clip link
        </button>
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onClose();
            onFile();
          }}
        >
          <FileIcon size={17} className="text-secondary" />
          Choose a file…
        </button>
      </div>
    </>
  );
}

export function Composer({
  placeholder,
  onText,
  onUrl,
  onFile,
  quote,
  className = "mx-auto mb-5 max-w-[800px]",
  showModel = true,
}: {
  placeholder: string;
  /** What sending plain text does on this screen. */
  onText: (text: string) => void;
  /** A card being replied to, shown above the box. Escape clears it. */
  quote?: { text: string; onClear: () => void } | undefined;
  /** A sent or pasted http(s) link. */
  onUrl: (url: string) => void;
  /** What + > Choose a file does on this screen. */
  onFile: () => void;
  className?: string;
  /** The agent and model picker in the footer, as in T3 Code. */
  showModel?: boolean;
}) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const focusRequest = useUi((s) => s.composerFocus);

  useEffect(() => {
    if (focusRequest === 0) return;
    input.current?.focus();
  }, [focusRequest]);

  // Grows with the text, up to six lines, then scrolls.
  useEffect(() => {
    const el = input.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
  }, [text]);

  const send = () => {
    if (text.trim().length === 0) return;
    if (looksLikeUrl(text)) onUrl(text.trim());
    else onText(text.trim());
    setText("");
  };
  // A link pasted into an empty composer goes straight in, like + > Paste a link.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (text.trim().length === 0 && looksLikeUrl(pasted)) {
      e.preventDefault();
      onUrl(pasted.trim());
    }
  };

  return (
    <form
      // A new key restarts the highlight each time something asks for the composer.
      key={focusRequest}
      data-testid="composer"
      className={`relative w-full rounded-2xl bg-surface/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-white/[0.07] backdrop-blur-xl transition-shadow focus-within:ring-white/[0.12] ${className} ${focusRequest > 0 ? "pulse-ring" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {quote !== undefined && (
        <div
          data-testid="reply-quote"
          className="mx-3 flex items-center gap-2 border-b border-white/[0.07] pt-2.5 pb-2 text-[12px] text-secondary"
        >
          <span aria-hidden className="h-4 w-0.5 shrink-0 rounded-full bg-accent" />
          <span className="min-w-0 flex-1 truncate">{quote.text}</span>
          <button
            type="button"
            data-testid="clear-reply"
            aria-label="Stop replying"
            title="Stop replying (Esc)"
            onClick={quote.onClear}
            className="grid size-6 place-items-center rounded-md text-tertiary outline-none hover:bg-white/[0.06] hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}
      <textarea
        ref={input}
        rows={1}
        data-testid="composer-input"
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && quote !== undefined) {
            e.stopPropagation();
            quote.onClear();
          }
        }}
        className="block max-h-[208px] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-[26px] outline-none placeholder:text-tertiary"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <IconButton
          label="Attach a file or paste a link"
          data-testid="attach"
          size="sm"
          active={menu}
          onClick={() => setMenu((m) => !m)}
        >
          <PlusIcon size={17} />
        </IconButton>
        {menu && (
          <AttachMenu
            onClose={() => setMenu(false)}
            onLink={() => input.current?.focus()}
            onFile={onFile}
          />
        )}
        <span className="flex-1" />
        {showModel && <ModelPicker />}
        <button
          type="submit"
          disabled={text.trim().length === 0}
          aria-label="Send"
          title="Send (Enter)"
          className="ml-1 grid size-8 place-items-center rounded-full bg-text text-[#0a0a0a] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] outline-none transition-[transform,background-color] hover:scale-105 hover:bg-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:scale-100 disabled:bg-white/[0.12] disabled:text-tertiary"
        >
          <ArrowUpIcon size={15} strokeWidth={2.4} />
        </button>
      </div>
    </form>
  );
}

/** A quiet way to start on Home, under the composer. */
function StartChip({
  icon,
  children,
  ...rest
}: { icon: ReactNode; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-tertiary outline-none transition-colors hover:bg-white/[0.06] hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
      {...rest}
    >
      <span className="text-tertiary">{icon}</span>
      {children}
    </button>
  );
}

/** A link from Home: main reads it, makes the stream, and we open it. */
export function useAddLink(): (url: string) => void {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (url) => {
    if (busy) return;
    setBusy(true);
    toast("Reading the link", "This takes a few seconds. Nothing is downloaded yet.");
    window.alcyo
      .invoke("link:add", { url })
      .then(
        (out) => {
          if ("failed" in out) toast("Couldn't use that link", out.message);
          else {
            useToasts.getState().dismiss();
            void router.navigate({ to: "/s/$streamId", params: { streamId: out.streamId } });
          }
        },
        (error: unknown) => toast("Couldn't use that link", plainError(error)),
      )
      .finally(() => setBusy(false));
  };
}

/** Choose a file, then open the new stream's thread. */
export function useChooseFile(): () => void {
  const router = useRouter();
  return () => {
    void chooseFile().then((streamId) => {
      if (streamId !== null) void router.navigate({ to: "/s/$streamId", params: { streamId } });
    });
  };
}

export function Home() {
  usePageTitle("New stream");
  const choose = useChooseFile();
  const addLink = useAddLink();
  const openDemo = useOpenDemo();
  const router = useRouter();
  const noProfile = useProfile((s) => s.view !== null && s.view.profile === null);
  const report = useSetup((s) => s.report);
  const issues = report === null || report.complete ? 0 : openIssues(report);
  return (
    <section className="relative flex h-full flex-col">
      <div className="drag h-[52px] shrink-0" aria-hidden />
      <div className="flex min-h-0 flex-1 overflow-y-auto px-6 sm:px-12">
        {/* Like T3 Code's new thread: a headline, then the composer at the
            center of the window, then a few quiet ways to start. */}
        <div
          data-testid="empty-thread"
          className="m-auto flex w-full max-w-[736px] -translate-y-[5vh] flex-col py-10"
        >
          <h1 className="text-center text-[30px] leading-[36px] font-normal tracking-[-0.02em]">
            Which stream should we cut?
          </h1>
          <p className="mt-2 text-center text-[14px] text-secondary">
            Paste a link or choose a recording. Your video stays on this computer.
          </p>
          {issues > 0 && (
            <div
              data-testid="home-setup-notice"
              className="mt-6 flex items-center gap-3 rounded-lg bg-warn/[0.06] px-3 py-2 text-[13px] text-secondary ring-1 ring-warn/15"
            >
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warn" />
              <span className="min-w-0 flex-1">
                Finding shorts needs an agent. Playing, editing and rendering work without one.
              </span>
              <Link
                to="/setup"
                className="shrink-0 rounded-md bg-white/[0.08] px-2.5 py-1 font-medium text-text outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-accent"
              >
                Connect an agent
              </Link>
            </div>
          )}
          <Composer
            className={issues > 0 ? "mt-3" : "mt-8"}
            onFile={choose}
            onUrl={addLink}
            placeholder="Paste a stream link or choose a recording"
            onText={() =>
              toast(
                "Start with a stream",
                "Paste a stream link or choose a recording. Chat opens once a stream is in.",
              )
            }
          />
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <StartChip data-testid="choose-file" icon={<FileIcon size={14} />} onClick={choose}>
              Choose a recording
            </StartChip>
            <StartChip data-testid="open-demo" icon={<FilmIcon size={14} />} onClick={openDemo}>
              Open the demo stream
            </StartChip>
          </div>
          {noProfile && (
            <button
              type="button"
              data-testid="home-profile"
              onClick={() => void router.navigate({ to: "/onboarding" })}
              className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-tertiary outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
            >
              <UserIcon size={13} />
              Set up your creator profile
            </button>
          )}
        </div>
      </div>
      <p className="pb-4 text-center text-[12px] text-tertiary">
        Only download videos you own or have permission to use.
      </p>
    </section>
  );
}

export function NotFound() {
  usePageTitle("Not found");
  const back = useBack();
  useEscape("screen", true, back);
  return (
    <section className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="drag absolute inset-x-0 top-0 h-12" aria-hidden />
      <span className="grid size-11 place-items-center rounded-xl border border-line bg-surface text-secondary">
        <AlertIcon size={20} />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.015em]">
          This link is unavailable
        </h1>
        <p
          data-testid="not-found"
          className="mx-auto max-w-[360px] text-[14px] leading-[22px] text-secondary"
        >
          {BAD_LINK_MESSAGE}
        </p>
      </div>
      <div className="mt-2 flex gap-2">
        <Button data-testid="back" onClick={back}>
          Back
        </Button>
        <ButtonLink to="/" variant="primary">
          Go home
        </ButtonLink>
      </div>
    </section>
  );
}
