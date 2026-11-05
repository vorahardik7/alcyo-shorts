// A stream's thread (plan section 4): the header pill, messages, composer.
// Shorts and version messages show as simple cards; spec 10 adds inline
// playback and the rest.
import type { AgentWork, StreamDetail, ChannelOutput } from "@alcyo/ipc";
import type { ClipFile, Message, ShortRef } from "@alcyo/schema";
import { useLocation, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePageTitle, useUi } from "../nav/navigation";
import { Composer, ThreadHeader } from "../shell/pages";
import { Button, ButtonLink } from "../ui/Button";
import { AlertIcon, CheckIcon, SparkIcon } from "../ui/icons";
import { Spinner } from "../ui/parts";
import { toast } from "../ui/toast";
import { ClipsBubble, QuestionBubble } from "./clips";
import { type ReplyTarget, ReplyQuote, ShortsBubble, VersionBubble, WorkingBubble } from "./shorts";
import { RenderBubble } from "./renders";
import { mergeMessage, plainError, useStreams } from "./store";

const PAGE = 200;

function StatusBubble({
  body,
  streamId,
}: {
  body: Extract<Message["body"], { kind: "status" }>;
  streamId: string;
}) {
  const running = body.state === "running";
  const failed = body.state === "failed";
  const [cancelling, setCancelling] = useState(false);
  // Finished work is a quiet line; running and failed work get a panel.
  const panel = running || failed;
  return (
    <div
      data-testid="status-message"
      data-state={body.state}
      className={
        panel
          ? `w-full max-w-[440px] rounded-xl border px-4 py-3 ${
              failed ? "border-bad/25 bg-bad/[0.06]" : "border-line bg-surface"
            }`
          : "w-full py-0.5"
      }
    >
      <div className="flex items-center gap-2.5">
        {running ? (
          <Spinner size={13} />
        ) : body.state === "done" ? (
          <CheckIcon size={14} strokeWidth={2.2} className="shrink-0 text-ok" />
        ) : (
          <AlertIcon size={14} className={`shrink-0 ${failed ? "text-bad" : "text-tertiary"}`} />
        )}
        <span
          data-testid="status-label"
          className={`min-w-0 flex-1 ${panel ? "text-[14px] text-text" : "text-[13px] text-tertiary"}`}
        >
          {body.label}
        </span>
        {!running &&
          (body.state === "failed" || body.state === "cancelled") &&
          body.jobKind === "analysis" &&
          body.targetId !== undefined && (
            <Button
              size="sm"
              onClick={() => {
                void window.alcyo
                  .invoke("analysis:start", { streamId, sourceId: body.targetId! })
                  .catch((e: unknown) => toast("Couldn't resume", plainError(e)));
              }}
            >
              Resume analysis
            </Button>
          )}
        {running && (
          <>
            <span className="text-[12px] text-tertiary tabular-nums">{Math.round(body.pct)}%</span>
            <Button
              size="sm"
              variant="ghost"
              data-testid="cancel-job"
              disabled={cancelling}
              className="-my-1 -mr-2 h-7 px-2"
              onClick={() => {
                setCancelling(true);
                window.alcyo.invoke("job:cancel", { jobId: body.jobId }).catch((e: unknown) => {
                  setCancelling(false);
                  toast("Couldn't cancel", plainError(e));
                });
              }}
            >
              Cancel
            </Button>
          </>
        )}
      </div>
      {running && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
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
  focus,
  showAuthor = false,
}: {
  message: Message;
  streamId: string;
  clips: readonly ClipFile[];
  answered: boolean;
  onChange: () => void;
  onReply: (target: ReplyTarget) => void;
  focus?: ShortRef | undefined;
  /** First of a run of agent messages: show who is talking. */
  showAuthor?: boolean;
}) {
  const mine = message.author === "user";
  const body = message.body;
  const author = showAuthor && message.author === "claude" ? <AuthorLabel /> : null;
  if (body.kind === "render") {
    return (
      <div id={`m-${message.id}`} data-testid="message" className="flex justify-start">
        <RenderBubble streamId={streamId} renderId={body.renderId} />
      </div>
    );
  }
  if (body.kind === "shorts" || body.kind === "version") {
    return (
      <div id={`m-${message.id}`} data-testid="message" className="flex flex-col items-start">
        {author}
        {body.kind === "shorts" ? (
          <ShortsBubble
            streamId={streamId}
            body={body}
            clips={clips}
            onReply={onReply}
            focus={focus}
          />
        ) : (
          <VersionBubble
            streamId={streamId}
            body={body}
            clips={clips}
            onReply={onReply}
            focus={focus}
          />
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
  if (body.kind === "status") {
    return (
      <div id={`m-${message.id}`} data-testid="message" className="flex justify-start">
        <StatusBubble body={body} streamId={streamId} />
      </div>
    );
  }
  if (body.kind !== "text") return null;
  if (mine) {
    return (
      <div
        id={`m-${message.id}`}
        data-testid="message"
        className="flex flex-col items-end pl-[18%]"
      >
        {message.replyTo !== undefined && (
          <ReplyQuote streamId={streamId} shortRef={message.replyTo} />
        )}
        <p
          data-testid="user-text"
          className="rounded-2xl rounded-br-md bg-raised px-3.5 py-2.5 text-[15px] leading-6 whitespace-pre-wrap select-text"
        >
          {body.text}
        </p>
      </div>
    );
  }
  // The app's own notes (a file was added, nothing was uploaded) are quiet
  // lines; the agent's words read as prose on the page, without a balloon.
  if (message.author === "app") {
    return (
      <div id={`m-${message.id}`} data-testid="message" className="flex justify-start">
        <p
          data-testid="agent-text"
          className="flex max-w-[680px] gap-2.5 py-0.5 text-[13px] leading-5 text-tertiary select-text"
        >
          <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line-strong" />
          <span className="whitespace-pre-wrap">{body.text}</span>
        </p>
      </div>
    );
  }
  return (
    <div id={`m-${message.id}`} data-testid="message" className="flex flex-col items-start">
      {author}
      <p
        data-testid="agent-text"
        className="max-w-[680px] text-[15px] leading-[1.65] whitespace-pre-wrap text-text select-text"
      >
        {body.text}
      </p>
    </div>
  );
}

/** "Agent", above the first of the agent's messages in a run. */
function AuthorLabel() {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-tertiary">
      <SparkIcon size={12} strokeWidth={2.2} className="text-accent-soft" />
      Agent
    </div>
  );
}

function MissingSource({ streamId, sourceId }: { streamId: string; sourceId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      data-testid="missing-source"
      className="flex items-center gap-4 rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3"
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

/** App notes and finished jobs: the routine bookkeeping of a stream. */
function isRoutine(m: Message): boolean {
  if (m.author !== "app") return false;
  return m.body.kind === "text" || (m.body.kind === "status" && m.body.state === "done");
}

interface ActivityRun {
  first: string;
  count: number;
  summary: string;
}

/**
 * Runs of three or more routine messages that something newer follows, by
 * message id. The latest run stays open, so work in progress is never folded.
 */
export function activityRuns(messages: readonly Message[]): Map<string, ActivityRun> {
  const out = new Map<string, ActivityRun>();
  let i = 0;
  while (i < messages.length) {
    if (!isRoutine(messages[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < messages.length && isRoutine(messages[j]!)) j++;
    const run = messages.slice(i, j);
    if (run.length >= 3 && j < messages.length) {
      let files = 0;
      let clips = 0;
      let analyzed = false;
      for (const m of run) {
        if (m.body.kind === "text" && m.body.text.startsWith("Added")) files++;
        if (m.body.kind === "status" && m.body.jobKind === "clip") clips++;
        if (m.body.kind === "status" && m.body.jobKind !== "clip") analyzed = true;
      }
      const parts = [
        files > 0 ? `${files} ${files === 1 ? "file" : "files"} added` : null,
        analyzed ? "analysis finished" : null,
        clips > 0 ? `${clips} ${clips === 1 ? "clip" : "clips"} placed` : null,
      ].filter((p): p is string => p !== null);
      const text = parts.length > 0 ? parts.join(" · ") : "Stream updates";
      const summary = text.charAt(0).toUpperCase() + text.slice(1);
      const entry = { first: run[0]!.id, count: run.length, summary };
      for (const m of run) out.set(m.id, entry);
    }
    i = j;
  }
  return out;
}

/** Keyed by stream, so moving between streams starts from a clean thread. */
export function StreamThread() {
  const { streamId = "", shortId, version } = useParams({ strict: false });
  const hash = useLocation({ select: (l) => l.hash });
  const n = version === undefined ? undefined : Number(version);
  const target =
    shortId === undefined
      ? undefined
      : { shortId, ...(n !== undefined && Number.isInteger(n) && n > 0 ? { version: n } : {}) };
  return (
    <Thread
      key={streamId}
      streamId={streamId}
      target={target}
      messageId={hash.startsWith("m-") ? decodeURIComponent(hash.slice(2)) : undefined}
    />
  );
}

/** The latest message showing this short (and version, when given), and the ref it shows. */
export function findShortMessage(
  messages: readonly Message[],
  target: { shortId: string; version?: number },
): { messageId: string; ref: ShortRef } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const refs =
      m.body.kind === "shorts" ? m.body.shorts : m.body.kind === "version" ? [m.body.ref] : [];
    const hit = refs.find(
      (r) =>
        r.shortId === target.shortId &&
        (target.version === undefined || r.version === target.version),
    );
    if (hit !== undefined) return { messageId: m.id, ref: hit };
  }
  return null;
}

function Thread({
  streamId,
  target,
  messageId,
}: {
  streamId: string;
  target?: { shortId: string; version?: number } | undefined;
  messageId?: string | undefined;
}) {
  const missingProject = useStreams((s) =>
    s.streams.some((row) => row.streamId === streamId && row.missing),
  );
  const [detail, setDetail] = useState<StreamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [working, setWorking] = useState<AgentWork | null>(null);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const focusComposer = useUi((s) => s.focusComposer);
  const end = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [older, setOlder] = useState<"more" | "loading" | "done">("more");
  const lastId = messages.at(-1)?.id;
  const linkedShortId = target?.shortId;
  const linkedVersion = target?.version;
  const linkKey = JSON.stringify([streamId, linkedShortId, linkedVersion, messageId]);
  const [lookup, setLookup] = useState<{
    key: string;
    result: ChannelOutput<"thread:locate">;
  } | null>(null);
  const linked = lookup?.key === linkKey ? lookup.result : null;
  const focus = linked?.ref == null ? null : { messageId: linked.message?.id, ref: linked.ref };
  const jumpTo = linked?.message?.id ?? messageId;
  useEffect(() => {
    if (linkedShortId === undefined && messageId === undefined) return;
    let live = true;
    void window.alcyo
      .invoke("thread:locate", {
        streamId,
        target:
          messageId === undefined
            ? {
                shortId: linkedShortId!,
                ...(linkedVersion === undefined ? {} : { version: linkedVersion }),
              }
            : { messageId },
      })
      .then(
        (result) => {
          if (live) setLookup({ key: linkKey, result });
        },
        (e: unknown) => {
          if (live) {
            setLookup({ key: linkKey, result: { message: null, ref: null } });
            toast("Couldn't open the link", plainError(e));
          }
        },
      );
    return () => {
      live = false;
    };
  }, [streamId, linkedShortId, linkedVersion, messageId, linkKey]);
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
    window.alcyo.invoke("thread:messages", { streamId, limit: PAGE }).then(
      (page) => {
        setMessages(page);
        if (page.length < PAGE) setOlder("done");
      },
      () => undefined,
    );
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

  // New messages at the end scroll into view, unless a link points elsewhere.
  useEffect(() => {
    if (jumpTo !== undefined) return;
    end.current?.scrollIntoView({ block: "end" });
  }, [lastId, working, jumpTo]);

  // A link to a message, short or version scrolls to it.
  useEffect(() => {
    if (jumpTo === undefined) return;
    document.getElementById(`m-${jumpTo}`)?.scrollIntoView({ block: "center" });
  }, [jumpTo, messages.length]);

  const loadOlder = useCallback(() => {
    const first = messages[0];
    if (older !== "more" || first === undefined) return;
    setOlder("loading");
    const el = scroller.current;
    const before = el === null ? 0 : el.scrollHeight - el.scrollTop;
    window.alcyo.invoke("thread:messages", { streamId, limit: PAGE, before: first.id }).then(
      (page) => {
        setMessages((list) => [...page.filter((m) => !list.some((x) => x.id === m.id)), ...list]);
        setOlder(page.length < PAGE ? "done" : "more");
        // Keep the reader's place after the older page goes in above.
        requestAnimationFrame(() => {
          if (el !== null) el.scrollTop = el.scrollHeight - before;
        });
      },
      () => setOlder("more"),
    );
  }, [messages, older, streamId]);

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
        {missingProject && (
          <Button
            size="sm"
            data-testid="locate-project"
            onClick={() => {
              void window.alcyo.invoke("stream:locate", { streamId }).then(
                (out) => {
                  if ("mismatch" in out) toast("That's a different project", out.message);
                  else if ("stream" in out) reload();
                },
                (e: unknown) => toast("Couldn't locate the project", plainError(e)),
              );
            }}
          >
            Locate project
          </Button>
        )}
        <ButtonLink to="/" size="sm">
          Go home
        </ButtonLink>
      </section>
    );
  }

  const lastAnalysisStatus = messages.findLast(
    (m) =>
      m.body.kind === "status" && (m.body.jobKind === "analysis" || m.body.jobKind === undefined),
  )?.body;
  const legacyInterrupted =
    lastAnalysisStatus?.kind === "status" &&
    lastAnalysisStatus.jobKind === undefined &&
    (lastAnalysisStatus.state === "failed" || lastAnalysisStatus.state === "cancelled");
  const name = detail?.stream.name ?? "";
  const missing = detail?.sources.filter((s) => s.missing) ?? [];
  const activity = activityRuns(messages);
  const shortCount = detail?.project.shorts.length ?? 0;
  const canAnalyze =
    detail !== null &&
    detail.sources.length > 0 &&
    detail.jobs.length === 0 &&
    (!detail.planner.ready || legacyInterrupted);
  const canFind = detail?.planner.ready === true && working === null;
  const actions = (
    <>
      {canAnalyze && (
        <Button
          size="sm"
          variant={canFind ? "secondary" : "primary"}
          data-testid="resume-analysis"
          onClick={() => {
            void window.alcyo
              .invoke("analysis:start", {
                streamId,
                sourceId: detail.sources[0]!.source.sourceId,
              })
              .catch((e: unknown) => toast("Couldn't resume", plainError(e)));
          }}
        >
          {detail.planner.ready ? "Resume analysis" : "Analyze recording"}
        </Button>
      )}
      {canFind && (
        <Button
          size="sm"
          variant={shortCount > 0 ? "secondary" : "primary"}
          data-testid="find-shorts"
          onClick={() => {
            window.alcyo
              .invoke("shorts:find", { streamId })
              .catch((e: unknown) => toast("Couldn't find shorts", plainError(e)));
          }}
        >
          <SparkIcon size={14} />
          {shortCount > 0 ? "Find more shorts" : "Find shorts"}
        </Button>
      )}
    </>
  );
  return (
    <section data-testid="stream-thread" className="relative flex h-full flex-col">
      <ThreadHeader
        label={detail === null ? "" : name}
        meta={
          detail === null
            ? undefined
            : shortCount > 0
              ? `${shortCount} ${shortCount === 1 ? "short" : "shorts"}`
              : undefined
        }
        actions={actions}
      />
      <div
        ref={scroller}
        data-testid="thread-scroll"
        onScroll={(e) => {
          if (e.currentTarget.scrollTop < 200 && target === undefined && messageId === undefined)
            loadOlder();
        }}
        className="relative min-h-0 flex-1 overflow-y-auto px-6 pt-8 pb-8 sm:px-12"
      >
        <div className="mx-auto flex w-full max-w-[800px] flex-col gap-3">
          {older === "more" && (target !== undefined || messageId !== undefined) && (
            <div className="flex justify-center">
              <Button size="sm" variant="ghost" onClick={loadOlder}>
                Load older messages
              </Button>
            </div>
          )}
          {older === "loading" && (
            <div className="flex justify-center py-2">
              <Spinner size={14} />
            </div>
          )}
          {(target !== undefined || messageId !== undefined) &&
            linked !== null &&
            linked.message === null && (
              <p
                data-testid="short-not-found"
                className="rounded-xl bg-warn/8 px-4 py-3 text-[14px] ring-1 ring-warn/20"
              >
                That{" "}
                {target === undefined
                  ? "message"
                  : target.version === undefined
                    ? "short"
                    : `version (v${target.version})`}{" "}
                isn&apos;t in this thread.
              </p>
            )}
          {linked?.message != null && !messages.some((m) => m.id === linked.message!.id) && (
            <div className="space-y-2 border-b border-hairline pb-4" data-testid="linked-message">
              <p className="text-[12px] text-tertiary">Linked message</p>
              <MessageView
                message={linked.message}
                streamId={streamId}
                clips={detail?.clips ?? []}
                answered={false}
                onChange={reload}
                onReply={onReply}
                focus={focus?.ref}
              />
            </div>
          )}
          {missing.map(({ source }) => (
            <MissingSource key={source.sourceId} streamId={streamId} sourceId={source.sourceId} />
          ))}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const side = (a: Message["author"]) => (a === "user" ? "user" : "other");
            const turn = prev !== undefined && side(prev.author) !== side(m.author);
            const run = activity.get(m.id);
            const linkedHere = jumpTo !== undefined && activity.get(jumpTo) === run;
            if (run !== undefined && !openRuns.has(run.first) && !linkedHere) {
              // A finished run of app notes folds into one line; the first
              // message stands in for the run.
              if (m.id !== run.first) return null;
              return (
                <div key={m.id} className={turn ? "pt-4" : ""}>
                  <button
                    type="button"
                    data-testid="activity-run"
                    onClick={() => setOpenRuns((s) => new Set(s).add(run.first))}
                    className="flex items-center gap-2.5 rounded-md py-0.5 text-[13px] text-tertiary outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <CheckIcon size={14} strokeWidth={2.2} className="shrink-0 text-ok" />
                    {run.summary}
                  </button>
                </div>
              );
            }
            return (
              <div key={m.id} className={turn ? "pt-4" : ""}>
                <MessageView
                  message={m}
                  streamId={streamId}
                  clips={detail?.clips ?? []}
                  answered={
                    m.body.kind === "question" &&
                    messages.slice(i + 1).some((n) => n.author === "user")
                  }
                  onChange={reload}
                  onReply={onReply}
                  focus={focus?.ref}
                  showAuthor={prev?.author !== "claude"}
                />
              </div>
            );
          })}
          {working !== null && <WorkingBubble jobId={working.jobId} label={working.label} />}
          <div ref={end} />
        </div>
      </div>
      <div className="relative px-6 sm:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-t from-bg to-transparent"
        />
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
