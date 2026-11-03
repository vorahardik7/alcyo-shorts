// Shorts and version messages as cards (plan section 4): an inline player
// with the render's crop and captions, title, hook, reason, length, the
// clipped badge, a version chip that links to the version, and Edit, Render,
// Copy link and Reply. Cards load their preview when scrolled into view.
import {
  type ClipFile,
  type Message,
  type ShortRef,
  formatAppLink,
  isPlaced,
  shortDuration,
} from "@alcyo/schema";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, buttonClass } from "../ui/Button";
import { LinkIcon } from "../ui/icons";
import { Spinner, copyText } from "../ui/parts";
import { toast } from "../ui/toast";
import { clock } from "./clips";
import { type Preview, ShortPlayer, useVisible } from "./player";
import { startRender } from "./renders";
import { plainError } from "./store";

export interface ReplyTarget {
  ref: ShortRef;
  title: string;
}

const length = (ms: number) => `${Math.round(ms / 1000)} s`;

/** A version's preview from main, once wanted. */
export function usePreview(
  streamId: string,
  ref: { shortId: string; version?: number },
  wanted = true,
): Preview | null | "missing" {
  const [p, setP] = useState<Preview | null | "missing">(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    window.alcyo
      .invoke("short:preview", {
        streamId,
        shortId: ref.shortId,
        ...(ref.version === undefined ? {} : { version: ref.version }),
      })
      .then(
        (out) => live && setP(out),
        () => live && setP("missing"),
      );
    return () => {
      live = false;
    };
  }, [streamId, ref.shortId, ref.version, wanted]);
  return p;
}

export function copyLink(link: string): void {
  void copyText(link).then((ok) =>
    ok ? toast("Link copied", link) : toast("Couldn't copy the link"),
  );
}

function ShortCard({
  streamId,
  shortRef,
  clips,
  onReply,
  width = "w-full",
  focused = false,
}: {
  streamId: string;
  shortRef: ShortRef;
  clips: readonly ClipFile[];
  onReply: (target: ReplyTarget) => void;
  width?: string;
  focused?: boolean;
}) {
  const [ref, { visible, seen }] = useVisible<HTMLDivElement>();
  const p = usePreview(streamId, shortRef, seen);
  // One element the observer keeps watching, whatever loads inside it.
  return (
    <div ref={ref} className={`${width} min-w-0`}>
      <CardBody
        streamId={streamId}
        shortRef={shortRef}
        clips={clips}
        onReply={onReply}
        focused={focused}
        visible={visible}
        p={p}
      />
    </div>
  );
}

function CardBody({
  streamId,
  shortRef,
  clips,
  onReply,
  focused,
  visible,
  p,
}: {
  streamId: string;
  shortRef: ShortRef;
  clips: readonly ClipFile[];
  onReply: (target: ReplyTarget) => void;
  focused: boolean;
  visible: boolean;
  p: Preview | null | "missing";
}) {
  const width = "w-full";
  if (p === null || p === "missing") {
    return (
      <div className={`${width} rounded-2xl bg-bubble-user/60 p-3 ring-1 ring-hairline`}>
        <div className="grid aspect-[9/16] place-items-center rounded-xl bg-black/40 text-[12px] text-tertiary">
          {p === "missing" ? "This version can't be read." : <Spinner size={14} />}
        </div>
      </div>
    );
  }
  const v = p.version;
  const s = v.short;
  const start = s.segments[0]!.srcIn;
  const end = s.segments.at(-1)!.srcOut;
  const clipped = clips.some(
    (c) => isPlaced(c.match) && c.match!.srcIn < end && c.match!.srcOut > start,
  );
  const params = { streamId, shortId: v.shortId, version: String(v.version) };
  const link = formatAppLink({ to: "short", streamId, shortId: v.shortId, version: v.version });
  return (
    <article
      data-testid="short-card"
      data-short-id={v.shortId}
      data-version={v.version}
      data-focused={focused || undefined}
      className={`flex ${width} min-w-0 flex-col gap-2 rounded-2xl bg-bubble-user/60 p-3 ring-1 transition-shadow ${
        focused ? "ring-2 ring-unread" : "ring-hairline"
      }`}
    >
      {visible ? (
        <ShortPlayer preview={p} playKey={`${v.shortId}-${v.version}-${shortRef.version}`} />
      ) : (
        <div className="aspect-[9/16] rounded-xl bg-black" />
      )}
      <div className="flex items-start gap-1 px-1 pt-1">
        <h3
          data-testid="short-title"
          className="min-w-0 flex-1 text-[15px] leading-snug font-semibold"
        >
          {s.title}
        </h3>
        <button
          type="button"
          data-testid="copy-link"
          aria-label="Copy link"
          title="Copy link"
          onClick={() => copyLink(link)}
          className="-mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-tertiary outline-none hover:bg-white/[0.06] hover:text-text focus-visible:ring-2 focus-visible:ring-unread"
        >
          <LinkIcon size={15} />
        </button>
      </div>
      {s.hook !== undefined && (
        <p className="px-1 text-[13px] leading-snug text-secondary">“{s.hook.text}”</p>
      )}
      <p className="px-1 text-[13px] leading-snug text-tertiary select-text">{s.reason}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 px-1 pt-1 text-[12px] text-tertiary tabular-nums">
        <Link
          to="/s/$streamId/short/$shortId/v/$version"
          params={params}
          data-testid="version-chip"
          className="rounded-full bg-bubble-claude px-2 py-0.5 text-secondary ring-1 ring-hairline outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-unread"
        >
          v{v.version} · {v.createdBy === "claude" ? "Agent" : "You"}
        </Link>
        <span>
          {clock(start)} · {length(shortDuration(s.segments))}
        </span>
        {clipped && (
          <span
            data-testid="clipped-badge"
            className="rounded-full bg-unread/15 px-2 py-0.5 text-unread"
          >
            Clipped by viewers
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Link
          to="/s/$streamId/short/$shortId/v/$version/edit"
          params={params}
          data-testid="open-editor"
          title="Open editor"
          className={buttonClass("ghost", "sm")}
        >
          Edit
        </Link>
        <Button
          size="sm"
          variant="ghost"
          data-testid="render-short"
          title="Render a 1080 × 1920 MP4 of this version"
          onClick={() => startRender(streamId, v.shortId, v.version)}
        >
          Render
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          data-testid="reply-short"
          onClick={() =>
            onReply({ ref: { shortId: v.shortId, version: v.version }, title: s.title })
          }
        >
          Reply
        </Button>
      </div>
    </article>
  );
}

export function ShortsBubble({
  streamId,
  body,
  clips,
  onReply,
  focus,
}: {
  streamId: string;
  body: Extract<Message["body"], { kind: "shorts" }>;
  clips: readonly ClipFile[];
  onReply: (target: ReplyTarget) => void;
  focus?: ShortRef | undefined;
}) {
  return (
    <div data-testid="shorts-message" className="w-full rounded-bubble bg-bubble-claude px-5 py-4">
      <p className="text-[15px] leading-relaxed select-text">{body.intro}</p>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-3">
        {body.shorts.map((ref) => (
          <ShortCard
            key={`${ref.shortId}-${ref.version}`}
            streamId={streamId}
            shortRef={ref}
            clips={clips}
            onReply={onReply}
            focused={focus?.shortId === ref.shortId && focus.version === ref.version}
          />
        ))}
      </div>
    </div>
  );
}

export function VersionBubble({
  streamId,
  body,
  clips,
  onReply,
  focus,
}: {
  streamId: string;
  body: Extract<Message["body"], { kind: "version" }>;
  clips: readonly ClipFile[];
  onReply: (target: ReplyTarget) => void;
  focus?: ShortRef | undefined;
}) {
  return (
    <div
      data-testid="version-message"
      className="max-w-full rounded-bubble bg-bubble-claude px-5 py-4"
    >
      <p className="text-[15px] leading-relaxed select-text">{body.whatChanged}</p>
      <div className="mt-3">
        <ShortCard
          streamId={streamId}
          shortRef={body.ref}
          clips={clips}
          onReply={onReply}
          width="w-60"
          focused={focus?.shortId === body.ref.shortId && focus.version === body.ref.version}
        />
      </div>
    </div>
  );
}

/** "Replying to “Title” v2" above a user's message. */
export function ReplyQuote({ streamId, shortRef }: { streamId: string; shortRef: ShortRef }) {
  const p = usePreview(streamId, shortRef);
  const title = p !== null && p !== "missing" ? p.version.short.title : "a short";
  return (
    <span className="mb-1 block text-right text-[12px] text-tertiary">
      Replying to “{title}” v{shortRef.version}
    </span>
  );
}

export function WorkingBubble({ jobId, label }: { jobId: string; label: string }) {
  const [cancelling, setCancelling] = useState(false);
  return (
    <div
      data-testid="working"
      className="flex w-fit max-w-md items-center gap-3 rounded-bubble bg-bubble-claude px-5 py-3"
    >
      <Spinner size={14} />
      <span className="text-[15px] text-secondary">{label}</span>
      <button
        type="button"
        data-testid="cancel-working"
        disabled={cancelling}
        onClick={() => {
          setCancelling(true);
          window.alcyo.invoke("job:cancel", { jobId }).catch((e: unknown) => {
            setCancelling(false);
            toast("Couldn't cancel", plainError(e));
          });
        }}
        className="rounded-full px-2 text-[13px] text-secondary outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-unread disabled:opacity-40"
      >
        Cancel
      </button>
    </div>
  );
}
