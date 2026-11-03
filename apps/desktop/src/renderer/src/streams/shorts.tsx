// Shorts and version messages as simple cards (plan section 4), and the
// agent's working line. Inline playback with crop and captions is spec 10.
import {
  type ClipFile,
  type Message,
  type ShortRef,
  type ShortVersion,
  isPlaced,
  shortDuration,
} from "@alcyo/schema";
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/parts";
import { toast } from "../ui/toast";
import { clock } from "./clips";
import { plainError } from "./store";

export interface ReplyTarget {
  ref: ShortRef;
  title: string;
}

const length = (ms: number) => `${Math.round(ms / 1000)} s`;

/** One version of a short, from main. Null while it loads or when it can't be read. */
function useVersion(streamId: string, ref: ShortRef): ShortVersion | null | "missing" {
  const [v, setV] = useState<ShortVersion | null | "missing">(null);
  useEffect(() => {
    let live = true;
    window.alcyo.invoke("short:get", { streamId, shortId: ref.shortId, version: ref.version }).then(
      (out) => live && setV(out.version),
      () => live && setV("missing"),
    );
    return () => {
      live = false;
    };
  }, [streamId, ref.shortId, ref.version]);
  return v;
}

function ShortCard({
  streamId,
  shortRef,
  clips,
  onReply,
  width = "w-full",
}: {
  streamId: string;
  shortRef: ShortRef;
  clips: readonly ClipFile[];
  onReply: (target: ReplyTarget) => void;
  width?: string;
}) {
  const v = useVersion(streamId, shortRef);
  if (v === null) {
    return <div className={`h-40 ${width} animate-pulse rounded-2xl bg-bubble-user/60`} />;
  }
  if (v === "missing") {
    return (
      <div className={`${width} rounded-2xl bg-bubble-user/60 p-4 text-[13px] text-tertiary`}>
        This version can&apos;t be read.
      </div>
    );
  }
  const s = v.short;
  const start = s.segments[0]!.srcIn;
  const end = s.segments.at(-1)!.srcOut;
  const clipped = clips.some(
    (c) => isPlaced(c.match) && c.match!.srcIn < end && c.match!.srcOut > start,
  );
  return (
    <article
      data-testid="short-card"
      data-short-id={v.shortId}
      data-version={v.version}
      className={`flex ${width} min-w-0 flex-col gap-2 rounded-2xl bg-bubble-user/60 p-4 ring-1 ring-hairline`}
    >
      <h3 data-testid="short-title" className="text-[15px] leading-snug font-semibold">
        {s.title}
      </h3>
      {s.hook !== undefined && (
        <p className="text-[14px] leading-snug text-secondary">“{s.hook.text}”</p>
      )}
      <p className="text-[13px] leading-snug text-tertiary select-text">{s.reason}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-[12px] text-tertiary tabular-nums">
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
      <div className="flex items-center justify-between gap-2">
        <span
          data-testid="version-chip"
          className="rounded-full bg-bubble-claude px-2 py-0.5 text-[12px] text-secondary ring-1 ring-hairline"
        >
          v{v.version} · {v.createdBy === "claude" ? "Agent" : "You"}
        </span>
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
}: {
  streamId: string;
  body: Extract<Message["body"], { kind: "shorts" }>;
  clips: readonly ClipFile[];
  onReply: (target: ReplyTarget) => void;
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
}: {
  streamId: string;
  body: Extract<Message["body"], { kind: "version" }>;
  clips: readonly ClipFile[];
  onReply: (target: ReplyTarget) => void;
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
        />
      </div>
    </div>
  );
}

/** "Replying to “Title” v2" above a user's message. */
export function ReplyQuote({ streamId, shortRef }: { streamId: string; shortRef: ShortRef }) {
  const v = useVersion(streamId, shortRef);
  const title = v !== null && v !== "missing" ? v.short.title : "a short";
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
