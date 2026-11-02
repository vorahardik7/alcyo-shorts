// A stream's thread (plan section 4): the header pill, messages, composer.
// This spec shows text and status messages; spec 10 adds cards, replies and
// the rest.
import type { StreamDetail } from "@alcyo/ipc";
import type { Message } from "@alcyo/schema";
import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePageTitle } from "../nav/navigation";
import { Composer, HeaderPill } from "../shell/pages";
import { Button, ButtonLink } from "../ui/Button";
import { AlertIcon, CheckIcon } from "../ui/icons";
import { Spinner } from "../ui/parts";
import { toast } from "../ui/toast";
import { mergeMessage, plainError } from "./store";

const PAGE = 200;

function StatusBubble({ body }: { body: Extract<Message["body"], { kind: "status" }> }) {
  const running = body.state === "running";
  const [cancelling, setCancelling] = useState(false);
  return (
    <div
      data-testid="status-message"
      data-state={body.state}
      className="w-full max-w-md rounded-bubble bg-bubble-claude px-5 py-3.5"
    >
      <div className="flex items-center gap-3">
        {running ? (
          <Spinner size={14} />
        ) : body.state === "done" ? (
          <CheckIcon size={16} className="shrink-0 text-ok" />
        ) : (
          <AlertIcon
            size={16}
            className={`shrink-0 ${body.state === "failed" ? "text-bad" : "text-tertiary"}`}
          />
        )}
        <span data-testid="status-label" className="min-w-0 flex-1 text-[15px]">
          {body.label}
        </span>
        {running && (
          <>
            <span className="text-[13px] text-tertiary tabular-nums">{Math.round(body.pct)}%</span>
            <button
              type="button"
              data-testid="cancel-job"
              disabled={cancelling}
              onClick={() => {
                setCancelling(true);
                window.alcyo.invoke("job:cancel", { jobId: body.jobId }).catch((e: unknown) => {
                  setCancelling(false);
                  toast("Couldn't cancel", plainError(e));
                });
              }}
              className="rounded-full px-2 text-[13px] text-secondary outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-unread disabled:opacity-40"
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {running && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-bubble-user">
          <div
            className="h-full rounded-full bg-unread transition-[width] duration-500"
            style={{ width: `${body.pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function MessageView({ message }: { message: Message }) {
  const mine = message.author === "user";
  const body = message.body;
  return (
    <div
      id={`m-${message.id}`}
      data-testid="message"
      className={`flex ${mine ? "justify-end" : "justify-start"}`}
    >
      {body.kind === "status" ? (
        <StatusBubble body={body} />
      ) : body.kind === "text" ? (
        <p
          className={`max-w-[75%] rounded-bubble px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap select-text ${
            mine ? "bg-bubble-user" : "bg-bubble-claude"
          }`}
        >
          {body.text}
        </p>
      ) : (
        <p className="rounded-bubble bg-bubble-claude px-5 py-3 text-[14px] text-tertiary">
          This message shows once shorts are built.
        </p>
      )}
    </div>
  );
}

function MissingSource({ streamId, sourceId }: { streamId: string; sourceId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      data-testid="missing-source"
      className="flex items-center gap-4 rounded-bubble bg-warn/8 px-5 py-3.5 ring-1 ring-warn/20"
    >
      <p className="min-w-0 flex-1 text-[14px]">
        The recording isn&apos;t where it was. Find it to keep working on this stream.
      </p>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          window.alcyo
            .invoke("source:relink", { streamId, sourceId })
            .then((out) => {
              if ("mismatch" in out) toast("That's a different file", out.message);
              else if ("source" in out) toast("Found it", "The stream points at the file again.");
            })
            .catch((e: unknown) => toast("Couldn't locate the file", plainError(e)))
            .finally(() => setBusy(false));
        }}
      >
        Locate file
      </Button>
    </div>
  );
}

/** Keyed by stream, so moving between streams starts from a clean thread. */
export function StreamThread() {
  const { streamId = "" } = useParams({ strict: false });
  return <Thread key={streamId} streamId={streamId} />;
}

function Thread({ streamId }: { streamId: string }) {
  const [detail, setDetail] = useState<StreamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const end = useRef<HTMLDivElement>(null);
  usePageTitle(detail?.stream.name ?? "Stream");

  const reload = useCallback(() => {
    window.alcyo.invoke("stream:open", { streamId }).then(
      (d) => {
        setDetail(d);
        setError(null);
      },
      (e: unknown) => setError(plainError(e)),
    );
  }, [streamId]);

  useEffect(() => {
    reload();
    window.alcyo
      .invoke("thread:messages", { streamId, limit: PAGE })
      .then(setMessages, () => undefined);
    const offMessage = window.alcyo.on("thread:message", (e) => {
      if (e.streamId !== streamId) return;
      setMessages((list) => mergeMessage(list, e.message));
      void window.alcyo.invoke("stream:markRead", { streamId }).catch(() => undefined);
      // A finished job changes the source (probe) and the job list.
      if (e.message.body.kind === "status" && e.message.body.state !== "running") reload();
    });
    void window.alcyo.invoke("stream:markRead", { streamId }).catch(() => undefined);
    return offMessage;
  }, [streamId, reload]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (error !== null) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="drag absolute inset-x-0 top-0 h-12" aria-hidden />
        <p data-testid="stream-placeholder" className="max-w-md text-body">
          {error}
        </p>
        <ButtonLink to="/" size="sm">
          Go home
        </ButtonLink>
      </section>
    );
  }

  const name = detail?.stream.name ?? "";
  const missing = detail?.sources.filter((s) => s.missing) ?? [];
  return (
    <section data-testid="stream-thread" className="relative flex h-full flex-col">
      <div className="drag absolute inset-x-0 top-0 h-12" aria-hidden />
      {detail !== null && <HeaderPill label={name} />}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-20 pb-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {missing.map(({ source }) => (
            <MissingSource key={source.sourceId} streamId={streamId} sourceId={source.sourceId} />
          ))}
          {messages.map((m) => (
            <MessageView key={m.id} message={m} />
          ))}
          <div ref={end} />
        </div>
      </div>
      <div className="px-6">
        <Composer
          placeholder={name.length > 0 ? `Message ${name}` : "Message"}
          onText={() =>
            toast("Chat comes in spec 10", "Messages to a stream go to Claude once it's built.")
          }
          onFile={() =>
            toast("Adding viewer clips comes in spec 6", "Start a new stream from the home screen.")
          }
        />
      </div>
    </section>
  );
}
