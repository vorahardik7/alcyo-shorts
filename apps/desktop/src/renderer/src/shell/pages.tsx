import { BAD_LINK_MESSAGE } from "@alcyo/schema";
import { useParams } from "@tanstack/react-router";
import { type ClipboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useBack, usePageTitle, useUi } from "../nav/navigation";
import { useEscape } from "../nav/overlays";
import { AppMark } from "../ui/AppMark";
import { Button, ButtonLink, IconButton } from "../ui/Button";
import {
  AlertIcon,
  ArrowUpIcon,
  FileIcon,
  LinkIcon,
  PlusIcon,
  ShieldIcon,
  SparkIcon,
} from "../ui/icons";
import { toast } from "../ui/toast";

const URL_RE = /^\s*https?:\/\/\S+\s*$/i;

export function looksLikeUrl(text: string): boolean {
  return URL_RE.test(text);
}

export const importLinkToast = () =>
  toast(
    "Importing links comes in spec 6",
    "Once it's built, a pasted link starts a stream here. Nothing was downloaded.",
  );
export const importFileToast = (name?: string) =>
  toast(
    "Importing files comes in spec 6",
    `${name === undefined ? "Files" : `“${name}”`} will open as a stream here. Nothing was copied or uploaded.`,
  );
const demoToast = () =>
  toast("The demo stream comes in spec 13", "It opens a ready-made stream with three shorts.");

function HeaderPill({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-[1] flex justify-center">
      <div
        data-testid="thread-header"
        className="no-drag pointer-events-auto flex max-w-[60%] items-center gap-2 truncate rounded-full bg-bubble-claude/90 py-1.5 pr-4 pl-2 text-small shadow-[0_4px_20px_rgba(0,0,0,0.35)] ring-1 ring-hairline backdrop-blur"
      >
        {icon ?? <AppMark size={22} />}
        <span className="truncate">{label}</span>
      </div>
    </div>
  );
}

function AttachMenu({ onClose, onLink }: { onClose: () => void; onLink: () => void }) {
  useEscape("overlay", true, onClose);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const item =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-small outline-none hover:bg-bubble-user focus-visible:bg-bubble-user active:bg-[#333]";
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <div
        role="menu"
        data-overlay
        data-testid="attach-menu"
        className="fade-in absolute bottom-14 left-0 z-30 w-64 rounded-[18px] bg-[#202020] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)] ring-1 ring-hairline"
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
            importFileToast();
          }}
        >
          <FileIcon size={17} className="text-secondary" />
          Choose a file…
        </button>
      </div>
    </>
  );
}

function Composer({
  placeholder,
  onText,
}: {
  placeholder: string;
  /** What sending plain text does on this screen. */
  onText: () => void;
}) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const focusRequest = useUi((s) => s.composerFocus);

  useEffect(() => {
    if (focusRequest === 0) return;
    input.current?.focus();
  }, [focusRequest]);

  const send = () => {
    if (text.trim().length === 0) return;
    if (looksLikeUrl(text)) importLinkToast();
    else onText();
    setText("");
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (looksLikeUrl(e.clipboardData.getData("text"))) importLinkToast();
  };

  return (
    <form
      // A new key restarts the highlight each time something asks for the composer.
      key={focusRequest}
      data-testid="composer"
      className={`relative mx-auto mb-6 flex w-full max-w-3xl items-center gap-2 rounded-full bg-bubble-claude py-2 pr-2 pl-2 ring-1 ring-hairline transition-shadow focus-within:ring-[#ffffff2e] ${focusRequest > 0 ? "pulse-ring" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <IconButton
        label="Attach a file or paste a link"
        data-testid="attach"
        active={menu}
        onClick={() => setMenu((m) => !m)}
      >
        <PlusIcon size={20} />
      </IconButton>
      {menu && <AttachMenu onClose={() => setMenu(false)} onLink={() => input.current?.focus()} />}
      <input
        ref={input}
        data-testid="composer-input"
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        className="min-w-0 flex-1 bg-transparent px-1 text-body outline-none placeholder:text-tertiary"
      />
      <button
        type="submit"
        disabled={text.trim().length === 0}
        aria-label="Send"
        title="Send"
        className="grid size-9 place-items-center rounded-full bg-text text-bg outline-none transition-[opacity,transform] hover:bg-white focus-visible:ring-2 focus-visible:ring-unread focus-visible:ring-offset-2 focus-visible:ring-offset-bubble-claude active:scale-95 disabled:opacity-25"
      >
        <ArrowUpIcon size={18} strokeWidth={2.2} />
      </button>
    </form>
  );
}

function ThreadFrame({
  header,
  placeholder,
  onText,
  children,
}: {
  header: string;
  placeholder: string;
  onText: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full flex-col">
      <div className="drag absolute inset-x-0 top-0 h-12" aria-hidden />
      <HeaderPill label={header} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-8 pt-16">
        {children}
      </div>
      <div className="px-6">
        <Composer placeholder={placeholder} onText={onText} />
      </div>
    </section>
  );
}

const STEPS = [
  {
    icon: LinkIcon,
    title: "Bring a stream",
    body: "Paste a YouTube or Twitch link, or drop a recording. Add viewer clips the same way.",
  },
  {
    icon: ShieldIcon,
    title: "Analyzed here",
    body: "Transcript and clip matching run on this computer. Video and audio never leave it.",
  },
  {
    icon: SparkIcon,
    title: "Shorts in the thread",
    body: "Claude proposes three. Ask for changes like you'd text an editor, or open the editor.",
  },
];

export function Home() {
  usePageTitle("New stream");
  const focusComposer = useUi((s) => s.focusComposer);
  return (
    <ThreadFrame
      header="New stream"
      placeholder="Paste a stream link or drop a recording"
      onText={() =>
        toast(
          "Start with a stream",
          "Paste a stream link or drop a recording. Chat opens once a stream is in.",
        )
      }
    >
      <div data-testid="empty-thread" className="w-full max-w-2xl py-8 text-center">
        <AppMark size={64} className="mx-auto drop-shadow-[0_10px_30px_rgba(79,107,245,0.35)]" />
        <h1 className="mt-6 text-[28px] font-semibold tracking-tight">Turn a stream into shorts</h1>
        <p className="mx-auto mt-2 max-w-lg text-body text-secondary">
          Paste a stream link or drop in a recording to start. Everything is processed on this
          computer.
        </p>

        <ol className="mt-8 grid grid-cols-3 gap-3 text-left">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="rounded-[20px] bg-card p-4 ring-1 ring-hairline">
                <div className="flex items-center gap-2 text-[13px] text-tertiary">
                  <span className="grid size-7 place-items-center rounded-full bg-bubble-user text-text">
                    <Icon size={15} />
                  </span>
                  Step {i + 1}
                </div>
                <p className="mt-3 text-small font-medium">{step.title}</p>
                <p className="mt-1 text-[14px] leading-snug text-secondary">{step.body}</p>
              </li>
            );
          })}
        </ol>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" data-testid="paste-link" onClick={focusComposer}>
            <LinkIcon size={17} />
            Paste a stream link
          </Button>
          <Button data-testid="choose-file" onClick={() => importFileToast()}>
            <FileIcon size={17} />
            Choose a file
          </Button>
          <Button variant="ghost" data-testid="open-demo" onClick={demoToast}>
            Open the demo stream
          </Button>
        </div>
        <p className="mt-6 text-[13px] text-tertiary">
          You can also drop a file anywhere in this window. Only download videos you own or have
          permission to use.
        </p>
      </div>
    </ThreadFrame>
  );
}

export function StreamPlaceholder() {
  const { streamId } = useParams({ strict: false });
  const name = streamId ?? "Stream";
  usePageTitle(name);
  return (
    <ThreadFrame
      header={name}
      placeholder={`Message ${name}`}
      onText={() =>
        toast("Chat comes in spec 10", "Messages to a stream go to Claude once streams exist.")
      }
    >
      <div className="max-w-md text-center">
        <p data-testid="stream-placeholder" className="text-body">
          This stream isn&apos;t in the app yet.
        </p>
        <p className="mt-2 text-small text-secondary">
          Streams open here once they&apos;re saved on this computer. Start one from the home
          screen.
        </p>
        <ButtonLink to="/" className="mt-5" size="sm">
          Go home
        </ButtonLink>
      </div>
    </ThreadFrame>
  );
}

export function NotFound() {
  usePageTitle("Not found");
  const back = useBack();
  useEscape("screen", true, back);
  return (
    <section className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="drag absolute inset-x-0 top-0 h-12" aria-hidden />
      <span className="grid size-12 place-items-center rounded-full bg-bubble-claude text-secondary ring-1 ring-hairline">
        <AlertIcon size={22} />
      </span>
      <p data-testid="not-found" className="text-body">
        {BAD_LINK_MESSAGE}
      </p>
      <div className="flex gap-3">
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
