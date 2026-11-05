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
import { Button, IconButton, buttonClass } from "../ui/Button";
import { LinkIcon, ReplyIcon } from "../ui/icons";
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
    let request = 0;
    let loaded: Preview | null = null;
    const reload = () => {
      const id = ++request;
      window.alcyo
        .invoke("short:preview", {
          streamId,
          shortId: ref.shortId,
          ...(ref.version === undefined ? {} : { version: ref.version }),
        })
        .then(
          (out) => {
            if (live && id === request) {
              loaded = out;
              setP(out);
            }
          },
          () => {
            if (live && id === request) setP("missing");
          },
        );
    };
    reload();
    const off = window.alcyo.on("source:changed", (e) => {
      if (
        e.streamId === streamId &&
        (loaded === null || loaded.version.sourceId === e.sourceId) &&
        (loaded?.src == null || e.reason === "relink")
      )
        reload();
    });
    return () => {
      live = false;
      off();
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
  row = false,
}: {
  streamId: string;
  shortRef: ShortRef;
  clips: readonly ClipFile[];
  onReply: (target: ReplyTarget) => void;
  width?: string;
  focused?: boolean;
  /** A revision: a small preview beside the text, not a full portrait card. */
  row?: boolean;
}) {
  const [ref, { visible, seen }] = useVisible<HTMLDivElement>();
  const p = usePreview(streamId, shortRef, seen);
  // One element the observer keeps watching, whatever loads inside it.
  return (
    <div ref={ref} className={`${width} h-full min-w-0`}>
      <CardBody
        streamId={streamId}
        shortRef={shortRef}
        clips={clips}
        onReply={onReply}
        focused={focused}
        visible={visible}
        p={p}
        row={row}
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
  row,
}: {
  streamId: string;
  shortRef: ShortRef;
  clips: readonly ClipFile[];
  onReply: (target: ReplyTarget) => void;
  focused: boolean;
  visible: boolean;
  p: Preview | null | "missing";
  row: boolean;
}) {
  if (p === null || p === "missing") {
    return (
      <div className="h-full w-full rounded-2xl border border-line bg-surface p-2">
        <div className="grid aspect-[9/16] place-items-center rounded-[10px] bg-black/40 text-[12px] text-tertiary">
          {p === "missing" ? "This version can't be read." : <Spinner size={14} />}
        </div>
        <div className="space-y-2 px-1.5 pt-3 pb-1.5">
          <div className="h-3.5 w-3/4 rounded bg-raised" />
          <div className="h-3 w-1/2 rounded bg-raised/70" />
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
      className={`flex h-full w-full min-w-0 rounded-xl bg-card p-1.5 ring-1 transition-[box-shadow,background-color] ${
        row ? "flex-row gap-1.5" : "flex-col"
      } ${focused ? "ring-2 ring-accent" : "ring-white/[0.06] hover:bg-surface hover:ring-white/[0.1]"}`}
    >
      <div className={row ? "relative w-[112px] shrink-0" : "relative"}>
        {visible ? (
          <ShortPlayer preview={p} playKey={`${v.shortId}-${v.version}-${shortRef.version}`} />
        ) : (
          <div className="aspect-[9/16] rounded-[10px] bg-black" />
        )}
      </div>
      <div className={`flex min-w-0 flex-1 flex-col ${row ? "px-2 py-1.5" : ""}`}>
        <div className="flex flex-1 flex-col px-2 pt-2.5">
          <h3
            data-testid="short-title"
            className="line-clamp-2 text-[14px] leading-5 font-semibold tracking-[-0.01em]"
          >
            {s.title}
          </h3>
          {s.hook !== undefined && (
            <p className="mt-1 line-clamp-1 text-[13px] leading-[18px] text-text/90">
              “{s.hook.text}”
            </p>
          )}
          <p
            className="mt-1 line-clamp-2 text-[13px] leading-[19px] text-secondary select-text"
            title={s.reason}
          >
            {s.reason}
          </p>
          <div className="mt-auto flex items-center gap-2 pt-3 text-[12px] text-[#9a9fa9] tabular-nums">
            <Link
              to="/s/$streamId/short/$shortId/v/$version"
              params={params}
              data-testid="version-chip"
              className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-secondary outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
            >
              v{v.version} · {v.createdBy === "claude" ? "Agent" : "You"}
            </Link>
            <span className="min-w-0 truncate">
              {clock(start)} · {length(shortDuration(s.segments))}
            </span>
            {clipped && (
              <span
                data-testid="clipped-badge"
                title="Viewers clipped part of this moment"
                className="ml-auto shrink-0 text-[11px] font-medium text-accent-soft"
              >
                Viewer clip
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-0.5 px-0.5 pb-0.5">
          <Link
            to="/s/$streamId/short/$shortId/v/$version/edit"
            params={params}
            data-testid="open-editor"
            title="Open editor"
            className={`${buttonClass("ghost", "sm")} h-7 px-2`}
          >
            Edit
          </Link>
          <Button
            size="sm"
            variant="primary"
            className="h-7 px-2.5"
            data-testid="render-short"
            title="Render a 1080 × 1920 MP4 of this version"
            onClick={() => startRender(streamId, v.shortId, v.version)}
          >
            Render
          </Button>
          <span className="flex-1" />
          <IconButton
            size="sm"
            className="size-7"
            label="Copy link"
            data-testid="copy-link"
            onClick={() => copyLink(link)}
          >
            <LinkIcon size={15} />
          </IconButton>
          <Button
            size="sm"
            variant="ghost"
            data-testid="reply-short"
            title="Reply to change this short"
            className="h-7 gap-1.5 px-2"
            onClick={() =>
              onReply({ ref: { shortId: v.shortId, version: v.version }, title: s.title })
            }
          >
            <ReplyIcon size={14} />
            Reply
          </Button>
        </div>
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
    <div data-testid="shorts-message" className="w-full">
      <p className="max-w-[680px] text-[15px] leading-[1.65] select-text">{body.intro}</p>
      <div className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(232px,248px))] gap-3">
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
    <div data-testid="version-message" className="w-full">
      <p className="max-w-[680px] text-[15px] leading-[1.65] select-text">{body.whatChanged}</p>
      <div className="mt-3.5">
        <ShortCard
          streamId={streamId}
          key={`${body.ref.shortId}/${body.ref.version}`}
          shortRef={body.ref}
          clips={clips}
          onReply={onReply}
          width="w-full max-w-[560px]"
          row
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
    <span className="mb-1.5 flex items-center gap-1.5 text-[12px] text-tertiary">
      <ReplyIcon size={12} />
      <span className="sr-only">Replying to</span>
      <span className="truncate">
        “{title}” v{shortRef.version}
      </span>
    </span>
  );
}

export function WorkingBubble({ jobId, label }: { jobId: string; label: string }) {
  const [cancelling, setCancelling] = useState(false);
  return (
    <div
      data-testid="working"
      className="mt-2 flex w-fit max-w-md items-center gap-2.5 rounded-xl border border-line bg-surface py-2 pr-2 pl-3.5"
    >
      <Spinner size={13} />
      <span className="text-[13px] text-secondary">{label}</span>
      <Button
        size="sm"
        variant="ghost"
        data-testid="cancel-working"
        disabled={cancelling}
        className="h-7 px-2"
        onClick={() => {
          setCancelling(true);
          window.alcyo.invoke("job:cancel", { jobId }).catch((e: unknown) => {
            setCancelling(false);
            toast("Couldn't cancel", plainError(e));
          });
        }}
      >
        Cancel
      </Button>
    </div>
  );
}
