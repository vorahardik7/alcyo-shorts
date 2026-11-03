// A stream's thread (plan section 4): the header pill, messages, composer.
// Shorts and version messages show as simple cards; spec 10 adds inline
// playback and the rest.
import type { AgentWork, StreamDetail } from "@alcyo/ipc";
import type { ClipFile, Message } from "@alcyo/schema";
import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePageTitle, useUi } from "../nav/navigation";
import { Composer, HeaderPill } from "../shell/pages";
import { Button, ButtonLink } from "../ui/Button";
import { AlertIcon, CheckIcon, SparkIcon } from "../ui/icons";
import { Spinner } from "../ui/parts";
import { toast } from "../ui/toast";
import { ClipsBubble, QuestionBubble } from "./clips";
import { type ReplyTarget, ReplyQuote, ShortsBubble, VersionBubble, WorkingBubble } from "./shorts";
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

function MessageView({
  message,
  streamId,
  clips,
  answered,
  onChange,
  onReply,
}: {
  message: Message;
  streamId: string;
  clips: readonly ClipFile[];
  answered: boolean;
  onChange: () => void;
  onReply: (target: ReplyTarget) => void;
}) {
  const mine = message.author === "user";
  const body = message.body;
  if (body.kind === "shorts" || body.kind === "version") {
    return (
      <div id={`m-${message.id}`} data-testid="message" className="flex justify-start">
        {body.kind === "shorts" ? (
          <ShortsBubble streamId={streamId} body={body} clips={clips} onReply={onReply} />
        ) : (
          <VersionBubble streamId={streamId} body={body} clips={clips} onReply={onReply} />
        )}
      </div>
    );
  }
  if (body.kind === "question" || body.kind === "clips") {
    return (
      <div id={`m-${message.id}`} data-testid="message" className="flex justify-start">
        {body.kind === "question" ? (
          <QuestionBubble streamId={streamId} message={{ ...message, body }} answered={answered} />
        ) : (
          <ClipsBubble
            streamId={streamId}
            clipIds={body.clipIds}
            clips={clips}
            onChange={onChange}
          />
        )}
      </div>
    );
  }
  return (
    <div
      id={`m-${message.id}`}
      data-testid="message"
      className={`flex ${mine ? "justify-end" : "justify-start"}`}
    >
      {body.kind === "status" ? (
        <StatusBubble body={body} />
      ) : body.kind === "text" ? (
        <div className="max-w-[75%]">
          {message.replyTo !== undefined && (
            <ReplyQuote streamId={streamId} shortRef={message.replyTo} />
          )}
          <p
            data-testid={mine ? "user-text" : "agent-text"}
            className={`rounded-bubble px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap select-text ${
              mine ? "bg-bubble-user" : "bg-bubble-claude"
            }`}
          >
            {body.text}
          </p>
        </div>
      ) : (
        <p className="rounded-bubble bg-bubble-claude px-5 py-3 text-[14px] text-tertiary">
          This message shows once renders are built.
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
  const [working, setWorking] = useState<AgentWork | null>(null);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const focusComposer = useUi((s) => s.focusComposer);
  const end = useRef<HTMLDivElement>(null);
  usePageTitle(detail?.stream.name ?? "Stream");

  const reload = useCallback(() => {
    window.alcyo.invoke("stream:open", { streamId }).then(
      (d) => {
        setDetail(d);
        setWorking(d.planner.working);
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
      // A finished job changes the sources, clips and job list.
      const body = e.message.body;
      if ((body.kind === "status" && body.state !== "running") || body.kind === "clips") reload();
    });
    const offWorking = window.alcyo.on("thread:working", (e) => {
      if (e.streamId !== streamId) return;
      setWorking(e.working);
      // The transcript may have just come in, which unlocks Find shorts.
      reload();
    });
    void window.alcyo.invoke("stream:markRead", { streamId }).catch(() => undefined);
    return () => {
      offMessage();
      offWorking();
    };
  }, [streamId, reload]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, working]);

  const onReply = useCallback(
    (target: ReplyTarget) => {
      setReply(target);
      focusComposer();
    },
    [focusComposer],
  );

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
          {messages.map((m, i) => (
            <MessageView
              key={m.id}
              message={m}
              streamId={streamId}
              clips={detail?.clips ?? []}
              answered={
                m.body.kind === "question" && messages.slice(i + 1).some((n) => n.author === "user")
              }
              onChange={reload}
              onReply={onReply}
            />
          ))}
          {working !== null && <WorkingBubble jobId={working.jobId} label={working.label} />}
          <div ref={end} />
        </div>
      </div>
      <div className="px-6">
        {detail?.planner.ready === true && working === null && (
          <div className="mx-auto mb-3 flex max-w-3xl justify-center">
            <Button
              size="sm"
              data-testid="find-shorts"
              onClick={() => {
                window.alcyo
                  .invoke("shorts:find", { streamId })
                  .catch((e: unknown) => toast("Couldn't find shorts", plainError(e)));
              }}
            >
              <SparkIcon size={14} />
              {detail.project.shorts.length > 0 ? "Find more shorts" : "Find shorts"}
            </Button>
          </div>
        )}
        <Composer
          placeholder={name.length > 0 ? `Message ${name}` : "Message"}
          quote={
            reply === null
              ? undefined
              : {
                  text: `Replying to “${reply.title}” v${reply.ref.version}`,
                  onClear: () => setReply(null),
                }
          }
          onText={(text) => {
            const to = reply;
            setReply(null);
            window.alcyo
              .invoke("chat:send", {
                streamId,
                text,
                ...(to === null ? {} : { replyTo: to.ref }),
              })
              .catch((e: unknown) => toast("Couldn't send that", plainError(e)));
          }}
          onUrl={(url) => {
            window.alcyo
              .invoke("link:add", { streamId, url })
              .catch((e: unknown) => toast("Couldn't use that link", plainError(e)));
          }}
          onFile={() => {
            // With a recording in, a chosen file is a viewer clip; before that, it's the recording.
            const asClip = (detail?.sources.length ?? 0) > 0;
            const call = asClip
              ? window.alcyo.invoke("clip:chooseFile", { streamId })
              : window.alcyo.invoke("source:chooseFile", { streamId });
            call.then(reload, (e: unknown) => toast("Couldn't add that file", plainError(e)));
          }}
        />
      </div>
    </section>
  );
}
