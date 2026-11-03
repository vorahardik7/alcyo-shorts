import { BAD_LINK_MESSAGE } from "@alcyo/schema";
import { useRouter } from "@tanstack/react-router";
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
import { AppMark } from "../ui/AppMark";
import { Button, ButtonLink, IconButton } from "../ui/Button";
import {
  AlertIcon,
  ArrowUpIcon,
  CloseIcon,
  FileIcon,
  LinkIcon,
  PlusIcon,
  SparkIcon,
  UserIcon,
} from "../ui/icons";
import { useProfile } from "../profile/store";
import { chooseFile, plainError } from "../streams/store";
import { toast, useToasts } from "../ui/toast";

const URL_RE = /^\s*https?:\/\/\S+\s*$/i;

export function looksLikeUrl(text: string): boolean {
  return URL_RE.test(text);
}

const demoToast = () =>
  toast("The demo stream comes in spec 13", "It opens a ready-made stream with three shorts.");

export function HeaderPill({ label, icon }: { label: string; icon?: ReactNode }) {
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
  className = "mx-auto mb-6 max-w-3xl",
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
    if (looksLikeUrl(text)) onUrl(text.trim());
    else onText(text.trim());
    setText("");
  };
  // A link pasted into an empty composer goes straight in, like + > Paste a link.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
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
      className={`relative flex w-full items-center gap-2 rounded-full bg-bubble-claude py-2 pr-2 pl-2 ring-1 ring-hairline transition-shadow focus-within:ring-[#ffffff2e] ${className} ${focusRequest > 0 ? "pulse-ring" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {quote !== undefined && (
        <div
          data-testid="reply-quote"
          className="absolute bottom-full left-4 mb-2 flex max-w-[80%] items-center gap-2 rounded-full bg-bubble-claude py-1 pr-1 pl-3 text-[13px] text-secondary ring-1 ring-hairline"
        >
          <span className="truncate">{quote.text}</span>
          <button
            type="button"
            data-testid="clear-reply"
            aria-label="Stop replying"
            title="Stop replying (Esc)"
            onClick={quote.onClear}
            className="grid size-6 place-items-center rounded-full outline-none hover:bg-bubble-user hover:text-text focus-visible:ring-2 focus-visible:ring-unread"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      <IconButton
        label="Attach a file or paste a link"
        data-testid="attach"
        active={menu}
        onClick={() => setMenu((m) => !m)}
      >
        <PlusIcon size={20} />
      </IconButton>
      {menu && (
        <AttachMenu
          onClose={() => setMenu(false)}
          onLink={() => input.current?.focus()}
          onFile={onFile}
        />
      )}
      <input
        ref={input}
        data-testid="composer-input"
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === "Escape" && quote !== undefined) {
            e.stopPropagation();
            quote.onClear();
          }
        }}
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

function Suggestion({
  icon,
  children,
  ...rest
}: { icon: ReactNode; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-secondary ring-1 ring-hairline outline-none transition-colors hover:bg-white/[0.04] hover:text-text focus-visible:ring-2 focus-visible:ring-unread active:scale-[0.97]"
      {...rest}
    >
      {icon}
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
  const router = useRouter();
  const noProfile = useProfile((s) => s.view !== null && s.view.profile === null);
  return (
    <section className="relative flex h-full flex-col">
      <div className="drag absolute inset-x-0 top-0 h-12" aria-hidden />
      {/* Like T3 Code's new thread: the composer sits at the center, the
          headline above it, and the quiet actions below. */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-8">
        <div data-testid="empty-thread" className="relative w-full max-w-[46rem]">
          <div className="absolute inset-x-0 bottom-full pb-7 text-center">
            <h1 className="text-[30px] leading-tight font-normal tracking-[-0.02em]">
              Which stream should we cut?
            </h1>
            <p className="mt-2 text-[14px] text-tertiary">
              Paste a link or choose a recording. Everything runs on this computer.
            </p>
          </div>
          <Composer
            className=""
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
          <div className="absolute inset-x-0 top-full flex flex-wrap justify-center gap-2 pt-4">
            <Suggestion data-testid="choose-file" icon={<FileIcon size={14} />} onClick={choose}>
              Choose a file
            </Suggestion>
            <Suggestion data-testid="open-demo" icon={<SparkIcon size={14} />} onClick={demoToast}>
              Open the demo stream
            </Suggestion>
            {noProfile && (
              <Suggestion
                data-testid="home-profile"
                icon={<UserIcon size={14} />}
                onClick={() => void router.navigate({ to: "/onboarding" })}
              >
                Set up your profile
              </Suggestion>
            )}
          </div>
        </div>
      </div>
      <p className="pb-5 text-center text-[13px] text-tertiary">
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
