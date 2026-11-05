// Viewer clips in the thread (plan section 12) and the link question
// (section 11). Clip data comes from stream:open; messages carry only ids.
import { type ClipFile, type Message, isPlaced } from "@alcyo/schema";
import { useState } from "react";
import { Button } from "../ui/Button";
import { toast } from "../ui/toast";
import { plainError } from "./store";

/** 1:02:03, 62:03 or 75 to ms. Null when it isn't a time. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length === 0 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  const seconds = nums.reduce((total, n) => total * 60 + n, 0);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const METHOD = {
  transcript: "Found from the words",
  audio: "Found from the sound",
  metadata: "From the clip's details",
  manual: "Placed by hand",
} as const;

function clipName(clip: ClipFile): string {
  if (clip.title !== undefined && clip.title.length > 0) return clip.title;
  return clip.origin.kind === "url" ? clip.origin.url : clip.origin.path;
}

function PlaceByHand({
  streamId,
  clip,
  onPlaced,
}: {
  streamId: string;
  clip: ClipFile;
  onPlaced: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(clip.match === null ? "" : clock(clip.match.srcIn));
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button size="sm" data-testid="place-by-hand" onClick={() => setOpen(true)}>
        Place by hand
      </Button>
    );
  }
  const ms = parseClock(text);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ms === null) return;
        setBusy(true);
        window.alcyo
          .invoke("clip:place", { streamId, clipId: clip.clipId, srcIn: ms })
          .then(onPlaced, (error: unknown) => toast("Couldn't place the clip", plainError(error)))
          .finally(() => setBusy(false));
      }}
    >
      <input
        autoFocus
        data-testid="place-time"
        aria-label="Where the clip starts in the stream"
        placeholder="1:02:03"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-8 w-28 rounded-lg border border-line-strong bg-raised px-2.5 text-[13px] tabular-nums outline-none placeholder:text-tertiary focus-visible:ring-2 focus-visible:ring-unread"
      />
      <Button size="sm" type="submit" disabled={busy || ms === null} data-testid="place-save">
        Save
      </Button>
    </form>
  );
}

export function ClipsBubble({
  streamId,
  clipIds,
  clips,
  onChange,
}: {
  streamId: string;
  clipIds: readonly string[];
  clips: readonly ClipFile[];
  onChange: () => void;
}) {
  return (
    <div
      data-testid="clips-message"
      className="w-full max-w-[480px] divide-y divide-line overflow-hidden rounded-xl border border-line bg-card"
    >
      {clipIds.map((id) => {
        const clip = clips.find((c) => c.clipId === id);
        if (clip === undefined) {
          return (
            <p key={id} className="px-4 py-3 text-[13px] text-tertiary">
              This clip was removed.
            </p>
          );
        }
        const placed = isPlaced(clip.match);
        return (
          <div
            key={id}
            data-testid="clip-row"
            data-placed={placed}
            className="flex flex-col gap-1 px-4 py-3"
          >
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden
                className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${placed ? "bg-accent" : "bg-warn"}`}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {clipName(clip)}
              </span>
              {clip.durationMs > 0 && (
                <span className="text-[12px] text-tertiary tabular-nums">
                  {clock(clip.durationMs)}
                </span>
              )}
            </div>
            {placed && clip.match !== null ? (
              <p data-testid="clip-placement" className="pl-3.5 text-[12px] text-secondary">
                In the stream at {clock(clip.match.srcIn)} to {clock(clip.match.srcOut)}.{" "}
                <span className="text-tertiary">{METHOD[clip.match.method]}.</span>
              </p>
            ) : (
              <p data-testid="clip-placement" className="pl-3.5 text-[12px] text-secondary">
                Couldn&apos;t place this clip. Enter where it starts in the stream.
              </p>
            )}
            {!placed && (
              <div className="pt-1 pl-3.5">
                <PlaceByHand streamId={streamId} clip={clip} onPlaced={onChange} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CHOICES = ["stream", "clip"] as const;

export function QuestionBubble({
  streamId,
  message,
  answered,
}: {
  streamId: string;
  message: Message & { body: { kind: "question" } };
  /** A later message from the user means it was answered. */
  answered: boolean;
}) {
  const [sent, setSent] = useState(false);
  const done = answered || sent;
  return (
    <div
      data-testid="question-message"
      className="w-full max-w-[480px] rounded-xl border border-line bg-card px-4 py-3"
    >
      <p className="text-[15px] leading-relaxed select-text">{message.body.text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {message.body.chips.map((chip, i) => {
          const choice = CHOICES[i];
          return (
            <Button
              key={chip}
              size="sm"
              disabled={done || choice === undefined}
              data-testid={`chip-${choice ?? i}`}
              onClick={() => {
                if (choice === undefined) return;
                setSent(true);
                window.alcyo
                  .invoke("link:answer", { streamId, messageId: message.id, choice })
                  .catch((error: unknown) => {
                    setSent(false);
                    toast("Couldn't send that", plainError(error));
                  });
              }}
            >
              {chip}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
