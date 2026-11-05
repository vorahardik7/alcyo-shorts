// The editor (plan section 6), at /s/<stream>/short/<short>/v/<n>/edit: the
// 9:16 preview, the transcript and side panels, the timeline, and the
// stream's chat beside it. Edits autosave as a draft (when editing the
// latest version) and Save makes a user version.
import { formatAppLink, rippleDeleteShortRange, shortDuration, splitAt } from "@alcyo/schema";
import { DraftSaver } from "@alcyo/store/draft-saver";
import type { Message, Short } from "@alcyo/schema";
import { Link, useParams, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackButton } from "../nav/BackButton";
import { isMac, usePageTitle } from "../nav/navigation";
import { Player, fmtTime } from "../streams/player";
import { startRender } from "../streams/renders";
import { copyLink } from "../streams/shorts";
import { mergeMessage, plainError } from "../streams/store";
import { Button, IconButton } from "../ui/Button";
import { ArrowUpIcon, UndoIcon } from "../ui/icons";
import { Kbd, Spinner } from "../ui/parts";
import { toast } from "../ui/toast";
import {
  CaptionsPanel,
  HookPanel,
  ReframePanel,
  SafeAreas,
  TranscriptPanel,
  cutOrRestoreSelection,
} from "./panels";
import { type Panel, ZOOM_STEPS, assFor, current, saveNote, useDirty, useEditor } from "./store";
import { Timeline } from "./Timeline";

const mod = isMac ? "⌘" : "Ctrl+";

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Play or pause"],
  ["J / K / L", "Back, pause, forward; again to speed up"],
  ["← / →", "One frame; with Shift, one second"],
  ["I / O", "Select from or to the playhead"],
  ["S", "Split at the playhead"],
  ["Delete", "Cut the selection, or the selected words"],
  [`${mod}Z / ⇧${mod}Z`, "Undo, redo"],
  [`${mod}S`, "Save version"],
  [`${mod}Enter`, "Render"],
  [`${mod}K`, "Focus the chat box"],
  [`⇧${mod}C`, "Copy link to this version"],
  ["+ / −", "Zoom the timeline"],
  ["?", "Show shortcuts"],
];

function isTyping(el: Element | null): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

type PendingDraft = { short: Short; baseVersion: number };
let activeDrafts: DraftSaver<PendingDraft> | null = null;
let savingVersion: { session: number; promise: Promise<number | null> } | null = null;

/** Save as a user version; resolves to the new version number, or null. */
function saveVersion(): Promise<number | null> {
  const session = useEditor.getState().session;
  if (savingVersion?.session === session) return savingVersion.promise;
  const pending = {
    session,
    promise: writeVersion().finally(() => {
      if (savingVersion === pending) savingVersion = null;
    }),
  };
  savingVersion = pending;
  return pending.promise;
}

async function writeVersion(): Promise<number | null> {
  const s = useEditor.getState();
  if (s.view === null) return null;
  const short = current();
  const drafts = activeDrafts;
  if (s.saved !== short) drafts?.edit({ short, baseVersion: s.base });
  try {
    // Keep a recoverable draft until the version has actually been saved.
    // A failed draft write must still allow an explicit version-save attempt.
    await drafts?.flush().catch(() => undefined);
    const v = await window.alcyo.invoke("short:saveVersion", {
      streamId: s.streamId,
      shortId: s.shortId,
      short,
      note: saveNote(s.history, s.savedAt),
      parent: s.base,
    });
    const view = await window.alcyo.invoke("editor:open", {
      streamId: s.streamId,
      shortId: s.shortId,
      version: v.version,
    });
    const latest = useEditor.getState();
    if (latest.view !== null && latest.session === s.session && latest.base === s.base) {
      latest.markSaved(short, v.version, view);
      // New edits made during the save are now drafts of the new version.
      // A navigated-away branch retains its own newer autosave.
      if (latest.history.present.value === short) {
        drafts?.cancel();
        await drafts?.settled();
        await window.alcyo.invoke("short:clearDraft", {
          streamId: s.streamId,
          shortId: s.shortId,
          baseVersion: s.base,
        });
      }
    }
    toast(`Saved v${v.version}`, v.note);
    return v.version;
  } catch (e) {
    toast("Couldn't save", plainError(e));
    return null;
  }
}

function useShortcuts(chatInput: React.RefObject<HTMLInputElement | null>, showHelp: () => void) {
  const router = useRouter();
  useEffect(() => {
    let reverse = 0;
    let rev: ReturnType<typeof setInterval> | undefined;
    let forward = 0;
    const stopReverse = () => {
      if (rev !== undefined) clearInterval(rev);
      rev = undefined;
      reverse = 0;
    };
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      if (s.view === null) return;
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      const p = s.player;
      if (cmd && (e.key === "z" || e.key === "Z")) {
        if (isTyping(document.activeElement)) return;
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (cmd && e.key === "s") {
        e.preventDefault();
        void saveVersion();
        return;
      }
      if (cmd && e.key === "Enter") {
        e.preventDefault();
        void (async () => {
          const st = useEditor.getState();
          const v = st.saved !== current() ? await saveVersion() : st.base;
          if (v !== null) startRender(st.streamId, st.shortId, v);
        })();
        return;
      }
      if (cmd && e.key === "k") {
        e.preventDefault();
        chatInput.current?.focus();
        return;
      }
      if (cmd && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        copyLink(
          formatAppLink({
            to: "short",
            streamId: s.streamId,
            shortId: s.shortId,
            version: s.base,
            edit: true,
          }),
        );
        return;
      }
      if (cmd || e.altKey || isTyping(document.activeElement)) return;
      const frame = (1000 * s.view.source.fpsDen) / s.view.source.fpsNum;
      switch (e.key) {
        case " ":
          e.preventDefault();
          stopReverse();
          forward = 0;
          p?.toggle();
          return;
        case "k":
        case "K":
          stopReverse();
          forward = 0;
          p?.pause();
          return;
        case "l":
        case "L":
          stopReverse();
          forward = Math.min(3, forward + 1);
          p?.play([1, 1, 2, 4][forward]);
          return;
        case "j":
        case "J":
          // Video can't play backwards, so J steps back on a timer.
          forward = 0;
          p?.pause();
          reverse = Math.min(3, reverse + 1);
          if (rev !== undefined) clearInterval(rev);
          rev = setInterval(() => {
            const st = useEditor.getState();
            if (st.t <= 0) {
              stopReverse();
              return;
            }
            st.seek(st.t - 100 * [1, 1, 2, 4][reverse]!);
          }, 100);
          return;
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          stopReverse();
          p?.pause();
          const d = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1000 : frame);
          s.seek(s.t + d);
          return;
        }
        case "i":
        case "I":
          s.set({
            sel: { from: s.t, to: Math.max(s.t, s.sel?.to ?? shortDuration(current().segments)) },
          });
          return;
        case "o":
        case "O":
          s.set({ sel: { from: Math.min(s.t, s.sel?.from ?? 0), to: s.t } });
          return;
        case "s":
        case "S":
          s.apply("Split", (sh) => splitAt(sh, s.t));
          return;
        case "Delete":
        case "Backspace": {
          e.preventDefault();
          if (s.sel !== null && s.sel.to > s.sel.from) {
            const { from, to } = s.sel;
            if (s.apply("Cut a range", (sh) => rippleDeleteShortRange(sh, from, to))) {
              s.set({ sel: null });
              s.seek(from);
            }
          } else if (s.words !== null) cutOrRestoreSelection();
          else if (s.key !== null) {
            const i = s.key;
            s.apply("Deleted a keyframe", (sh) =>
              sh.crop.keys.length <= 1
                ? { ok: false, reason: "A short keeps at least one keyframe." }
                : {
                    ok: true,
                    value: { ...sh, crop: { keys: sh.crop.keys.filter((_, j) => j !== i) } },
                  },
            );
            s.set({ key: null });
          }
          return;
        }
        case "+":
        case "=":
          s.set({ zoom: Math.min(ZOOM_STEPS.length - 1, s.zoom + 1) });
          return;
        case "-":
        case "_":
          s.set({ zoom: Math.max(0, s.zoom - 1) });
          return;
        case "?":
          showHelp();
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopReverse();
    };
  }, [router, chatInput, showHelp]);
}

function ChatDrawer({
  streamId,
  inputRef,
}: {
  streamId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const shortId = useEditor((s) => s.shortId);
  const base = useEditor((s) => s.base);
  const end = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<"short" | "stream">("short");

  useEffect(() => {
    window.alcyo
      .invoke("thread:messages", { streamId, limit: 60 })
      .then(setMessages, () => undefined);
    const off = window.alcyo.on("thread:message", (e) => {
      if (e.streamId === streamId) setMessages((l) => mergeMessage(l, e.message));
    });
    const offW = window.alcyo.on("thread:working", (e) => {
      if (e.streamId === streamId) setWorking(e.working?.label ?? null);
    });
    return () => {
      off();
      offW();
    };
  }, [streamId]);
  useEffect(() => {
    // Chromium's scrollIntoView returns a Promise; never hand it back as a cleanup.
    void end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, working]);

  const line = (m: Message) => {
    const b = m.body;
    switch (b.kind) {
      case "text":
        return b.text;
      case "version":
        return `${m.author === "user" ? "You saved" : "Saved"} v${b.ref.version}: ${b.whatChanged}`;
      case "shorts":
        return scope === "short"
          ? `Proposed this short (v${b.shorts.find((r) => r.shortId === shortId)?.version ?? 1})`
          : b.intro;
      case "question":
        return b.text;
      default:
        return null;
    }
  };

  // "This short": your requests about it, the replies right after them, its
  // versions, and the message that proposed it. "Whole stream": everything.
  const all = messages
    .map((m) => ({ m, text: line(m) }))
    .filter((x): x is { m: Message; text: string } => x.text !== null);
  const about = (m: Message) =>
    m.replyTo?.shortId === shortId ||
    (m.body.kind === "version" && m.body.ref.shortId === shortId) ||
    (m.body.kind === "shorts" &&
      m.body.shorts.length === 1 &&
      m.body.shorts[0]!.shortId === shortId);
  const shown = (
    scope === "stream"
      ? all
      : all.filter(({ m }, i) => {
          if (m.author === "app") return false;
          if (about(m)) return true;
          const prev = all[i - 1]?.m;
          return (
            m.author === "claude" && prev !== undefined && prev.author === "user" && about(prev)
          );
        })
  ).slice(-40);

  return (
    <aside
      data-testid="chat-drawer"
      className="flex min-h-0 w-[320px] shrink-0 flex-col border-l border-hairline bg-sidebar"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-3 text-[13px] font-medium">
        Chat
        <div
          role="radiogroup"
          aria-label="Which messages"
          className="ml-1 flex rounded-md bg-white/[0.04] p-0.5 text-[11px] font-medium"
        >
          {(
            [
              ["short", "This short"],
              ["stream", "Whole stream"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={scope === id}
              onClick={() => setScope(id)}
              className={`h-5 rounded-[5px] px-2 outline-none focus-visible:ring-2 focus-visible:ring-accent ${scope === id ? "bg-white/[0.1] text-text" : "text-tertiary hover:text-secondary"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] font-normal text-tertiary">
          <Kbd>{mod}K</Kbd>
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {shown.length === 0 && (
          <p className="text-[12px] leading-5 text-tertiary">
            Nothing about this short yet. Ask for a change below; the agent makes a new version.
          </p>
        )}
        {shown.map(({ m, text: t }) => (
          <p
            key={m.id}
            className={`text-[13px] leading-[1.55] select-text ${m.author === "user" ? "ml-8 rounded-2xl rounded-br-md bg-raised px-3 py-2" : m.author === "app" ? "mr-4 text-[12px] text-tertiary" : "mr-4 text-text"}`}
          >
            {t}
          </p>
        ))}
        {working !== null && (
          <p className="flex items-center gap-2 text-[12px] text-tertiary">
            <Spinner size={11} /> {working}
          </p>
        )}
        <div ref={end} />
      </div>
      <form
        className="relative p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const msg = text.trim();
          if (msg.length === 0) return;
          setText("");
          window.alcyo
            .invoke("chat:send", { streamId, text: msg, replyTo: { shortId, version: base } })
            .catch((err: unknown) => toast("Couldn't send that", plainError(err)));
        }}
      >
        <input
          ref={inputRef}
          data-testid="drawer-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Ask for a change to v${base}`}
          className="h-11 w-full rounded-2xl bg-surface/90 pr-12 pl-3.5 text-[13px] ring-1 ring-white/[0.07] outline-none placeholder:text-tertiary focus-visible:ring-white/[0.12]"
        />
        <button
          type="submit"
          aria-label="Send"
          title="Send (Enter)"
          disabled={text.trim().length === 0}
          className="absolute top-1/2 right-[18px] grid size-8 -translate-y-1/2 place-items-center rounded-full bg-text text-[#111214] outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:bg-raised disabled:text-tertiary"
        >
          <ArrowUpIcon size={14} strokeWidth={2.4} />
        </button>
      </form>
    </aside>
  );
}

const PANELS: Array<[Panel, string]> = [
  ["transcript", "Transcript"],
  ["captions", "Captions"],
  ["reframe", "Reframe"],
  ["hook", "Hook"],
];

export function Editor() {
  const { streamId = "", shortId = "", version = "" } = useParams({ strict: false });
  return (
    <EditorFor
      key={`${streamId}/${shortId}`}
      streamId={streamId}
      shortId={shortId}
      version={version}
    />
  );
}

function EditorFor({
  streamId,
  shortId,
  version,
}: {
  streamId: string;
  shortId: string;
  version: string;
}) {
  const router = useRouter();
  const view = useEditor((s) => s.view);
  const short = useEditor((s) => s.history.present.value);
  const base = useEditor((s) => s.base);
  const panel = useEditor((s) => s.panel);
  const guides = useEditor((s) => s.guides);
  const set = useEditor((s) => s.set);
  const load = useEditor((s) => s.load);
  const history = useEditor((s) => s.history);
  const dirty = useDirty();
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [incoming, setIncoming] = useState<number | null>(null);
  const chatInput = useRef<HTMLInputElement>(null);
  const showHelp = useCallback(() => setHelp((h) => !h), []);
  useShortcuts(chatInput, showHelp);
  usePageTitle(view === null ? "Editor" : `Edit · ${short.title}`);

  const saver = useMemo(
    () =>
      new DraftSaver<PendingDraft>(
        ({ short: draft, baseVersion }) =>
          window.alcyo
            .invoke("short:saveDraft", {
              streamId,
              shortId,
              short: draft,
              baseVersion,
            })
            .then(() => undefined),
        Date.now,
        (e) =>
          toast(
            "Autosave failed",
            `${plainError(e)} Your edits are still open; use Save version or retry.`,
          ),
      ),
    [streamId, shortId],
  );
  useEffect(() => {
    activeDrafts = saver;
    return () => {
      if (activeDrafts === saver) activeDrafts = null;
      void saver.flush().catch(() => undefined);
      useEditor.getState().set({ view: null, player: null });
    };
  }, [saver]);

  const loadingRoute = useRef<string | null>(null);
  useEffect(() => {
    const n = Number(version);
    const st = useEditor.getState();
    if (st.view !== null && st.streamId === streamId && st.shortId === shortId && st.base === n)
      return;
    let live = true;
    loadingRoute.current = version;
    void (async () => {
      await saver.flush();
      const v = await window.alcyo.invoke("editor:open", {
        streamId,
        shortId,
        ...(Number.isInteger(n) && n > 0 ? { version: n } : {}),
      });
      if (!live) return;
      loadingRoute.current = null;
      load(streamId, v, v.draft !== null);
      setError(null);
      if (v.draft !== null) toast("Restored your unsaved edits", "From this version's autosave.");
    })().catch((e: unknown) => {
      if (live) {
        loadingRoute.current = null;
        setError(plainError(e));
      }
    });
    return () => {
      live = false;
    };
  }, [streamId, shortId, version, load, saver]);

  // A save changes the base without discarding undo history. An incoming URL
  // is loaded above first, instead of being replaced with the old base.
  useEffect(() => {
    if (view === null || loadingRoute.current !== null || String(base) === version) return;
    void router.navigate({
      to: "/s/$streamId/short/$shortId/v/$version/edit",
      params: { streamId, shortId, version: String(base) },
      replace: true,
    });
  }, [base, version, view, router, streamId, shortId]);

  useEffect(() => {
    if (view === null) return;
    if (dirty) saver.edit({ short, baseVersion: base });
    else {
      saver.cancel();
      void saver
        .settled()
        .then(() =>
          window.alcyo.invoke("short:clearDraft", {
            streamId,
            shortId,
            baseVersion: base,
          }),
        )
        .catch((e: unknown) => toast("Couldn't clear autosave", plainError(e)));
    }
  }, [short, dirty, base, view, saver, streamId, shortId]);

  // Keep windowed transcript reads: expand only when an edit reaches an edge.
  const [mediaRevision, setMediaRevision] = useState(0);
  useEffect(
    () =>
      window.alcyo.on("source:changed", (e) => {
        if (e.streamId === streamId) setMediaRevision((n) => n + 1);
      }),
    [streamId],
  );
  const lastMediaRevision = useRef(0);
  const fromMs = short.segments?.[0]?.srcIn ?? 0;
  const toMs = short.segments?.at(-1)?.srcOut ?? 0;
  useEffect(() => {
    if (view === null || loadingRoute.current !== null) return;
    const refresh = mediaRevision !== lastMediaRevision.current;
    if (!refresh && fromMs >= view.window.fromMs && toMs <= view.window.toMs) return;
    let live = true;
    void window.alcyo
      .invoke("editor:open", {
        streamId,
        shortId,
        version: base,
        range: { fromMs, toMs },
      })
      .then(
        (next) => {
          const st = useEditor.getState();
          if (!live || st.base !== base || st.shortId !== shortId) return;
          lastMediaRevision.current = mediaRevision;
          st.set({ view: next });
        },
        (e: unknown) => {
          if (live) toast("Couldn't load this part", plainError(e));
        },
      );
    return () => {
      live = false;
    };
  }, [streamId, shortId, base, fromMs, toMs, view, mediaRevision]);

  // A new version of this short from the agent: offer it.
  useEffect(
    () =>
      window.alcyo.on("thread:message", (e) => {
        const b = e.message.body;
        if (e.streamId !== streamId || b.kind !== "version" || b.ref.shortId !== shortId) return;
        if (e.message.author !== "claude") return;
        setIncoming(b.ref.version);
      }),
    [streamId, shortId],
  );
  const takeIncoming = async () => {
    if (incoming === null) return;
    const session = useEditor.getState().session;
    await saver.flush();
    const v = await window.alcyo.invoke("editor:open", { streamId, shortId, version: incoming });
    const st = useEditor.getState();
    if (st.session !== session || st.view === null) return;
    st.apply(`Agent's v${incoming}`, () => v.version.short);
    st.markSaved(v.version.short, incoming, v);
    setIncoming(null);
  };

  const ass = useMemo(() => (view === null ? "" : assFor(view, short)), [view, short]);

  if (error !== null) {
    return (
      <section className="grid h-full place-items-center px-8 text-center">
        <div>
          <p data-testid="short-missing" className="text-secondary">
            That version isn&apos;t in this stream.
          </p>
          <Link
            to="/s/$streamId"
            params={{ streamId }}
            className="mt-3 inline-block text-[14px] underline-offset-2 hover:underline"
          >
            Open the stream
          </Link>
        </div>
      </section>
    );
  }
  if (view === null) {
    return (
      <section className="grid h-full place-items-center">
        <Spinner />
      </section>
    );
  }
  const vs = view.versions.find((x) => x.version === base);
  const origin =
    vs === undefined
      ? ""
      : `${vs.createdBy === "claude" ? "Agent" : "You"} v${base}${view.fromMessage !== null ? `, from your message “${view.fromMessage.slice(0, 60)}”` : vs.parent !== null && vs.parent !== base - 1 ? `, from v${vs.parent}` : ""}`;

  return (
    <section data-testid="editor" data-version={base} className="flex h-full min-h-0 flex-col">
      <header
        className={`drag flex h-[52px] shrink-0 items-center gap-3 border-b border-hairline pr-4 ${isMac ? "pl-[84px]" : "pl-4"}`}
      >
        <BackButton />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] leading-tight font-semibold">{short.title}</h1>
          <p data-testid="editor-origin" className="truncate text-[12px] text-tertiary">
            {origin}
            {dirty && <span className="text-warn"> · Unsaved edits</span>}
          </p>
        </div>
        <select
          data-testid="versions"
          aria-label="Versions"
          value={base}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (
              dirty &&
              !window.confirm("Open another version? Your edits stay in this version’s autosave.")
            )
              return;
            void router.navigate({
              to: "/s/$streamId/short/$shortId/v/$version/edit",
              params: { streamId, shortId, version: String(n) },
            });
          }}
          title="Versions of this short"
          className="no-drag h-8 w-[190px] shrink-0 truncate rounded-lg border border-line-strong bg-raised px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {[...view.versions].reverse().map((x) => (
            <option key={x.version} value={x.version}>
              v{x.version} · {x.createdBy === "claude" ? "Agent" : "You"} ·{" "}
              {x.note.slice(0, 40) || "No note"}
            </option>
          ))}
        </select>
        {base !== view.head && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="restore-version"
            onClick={() => {
              const started = useEditor.getState();
              const stillCurrent = () => {
                const st = useEditor.getState();
                return (
                  st.view !== null &&
                  st.session === started.session &&
                  st.base === base &&
                  st.history === started.history
                );
              };
              void (async () => {
                await saver.flush();
                const v = await window.alcyo.invoke("short:restore", {
                  streamId,
                  shortId,
                  version: base,
                });
                if (!stillCurrent()) return;
                const nv = await window.alcyo.invoke("editor:open", {
                  streamId,
                  shortId,
                  version: v.version,
                });
                if (!stillCurrent()) return;
                load(streamId, nv, false);
                toast(`Restored as v${v.version}`);
              })().catch((e: unknown) => toast("Couldn't restore", plainError(e)));
            }}
          >
            Restore as latest
          </Button>
        )}
        <div className="no-drag flex items-center">
          <IconButton
            size="sm"
            label={`Undo (${mod}Z)`}
            data-testid="undo"
            disabled={history.past.length === 0}
            onClick={() => useEditor.getState().undo()}
          >
            <UndoIcon size={16} />
          </IconButton>
          <IconButton
            size="sm"
            label={`Redo (⇧${mod}Z)`}
            data-testid="redo"
            disabled={history.future.length === 0}
            onClick={() => useEditor.getState().redo()}
          >
            <UndoIcon size={16} className="-scale-x-100" />
          </IconButton>
        </div>
        <span aria-hidden className="h-5 w-px bg-line" />
        <Button
          size="sm"
          data-testid="save-version"
          disabled={!dirty}
          onClick={() => void saveVersion()}
          title={`Save version (${mod}S)`}
        >
          Save version
        </Button>
        <Button
          size="sm"
          variant="primary"
          data-testid="editor-render"
          title={`Render (${mod}Enter)`}
          onClick={() =>
            void (async () => {
              const v = dirty ? await saveVersion() : base;
              if (v !== null) startRender(streamId, shortId, v);
            })()
          }
        >
          Render
        </Button>
        <IconButton size="sm" label="Shortcuts (?)" data-testid="shortcuts" onClick={showHelp}>
          <span className="text-[14px] font-semibold">?</span>
        </IconButton>
      </header>

      {incoming !== null && (
        <div
          data-testid="incoming"
          className="flex items-center gap-3 border-b border-accent/20 bg-accent/[0.08] px-4 py-2 text-[13px]"
        >
          <span className="flex-1">The agent made v{incoming} of this short.</span>
          <Button
            size="sm"
            variant="primary"
            data-testid="take-incoming"
            onClick={() => void takeIncoming()}
          >
            Load v{incoming}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setIncoming(null)}>
            Keep editing
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 gap-4 p-4">
            <div className="flex w-[clamp(14rem,24vw,20rem)] shrink-0 flex-col gap-2">
              <Player
                short={short}
                src={view.source.src}
                width={view.source.width}
                height={view.source.height}
                ass={ass}
                playKey={`editor-${shortId}`}
                handle={(h) => {
                  useEditor.getState().set({ player: h });
                }}
                onTime={(t) => useEditor.getState().setT(t)}
                overlay={guides ? <SafeAreas platforms={view.platforms} /> : undefined}
                className="max-h-full w-full"
                bare
              />
              <Transport />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-card">
              <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-2 py-1.5">
                {PANELS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={panel === id}
                    data-testid={`panel-${id}`}
                    onClick={() => set({ panel: id })}
                    className={`h-7 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${panel === id ? "bg-white/[0.08] text-text" : "text-tertiary hover:text-text"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {panel === "transcript" ? (
                  <TranscriptPanel />
                ) : panel === "captions" ? (
                  <CaptionsPanel />
                ) : panel === "reframe" ? (
                  <ReframePanel />
                ) : (
                  <HookPanel />
                )}
              </div>
            </div>
          </div>
          <div className="h-[200px] shrink-0 border-t border-hairline">
            <Timeline />
          </div>
        </div>
        <ChatDrawer streamId={streamId} inputRef={chatInput} />
      </div>

      {help && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60"
          onClick={() => setHelp(false)}
          data-overlay
        >
          <div
            data-testid="shortcut-help"
            className="w-[420px] rounded-xl border border-line-strong bg-surface p-5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-[15px] font-semibold">Editor shortcuts</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              {SHORTCUTS.map(([k, what]) => (
                <div key={k} className="contents">
                  <dt>
                    <Kbd>{k}</Kbd>
                  </dt>
                  <dd className="text-secondary">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}

function Transport() {
  const t = useEditor((s) => s.t);
  const short = useEditor((s) => s.history.present.value);
  const player = useEditor((s) => s.player);
  const [, force] = useState(0);
  return (
    <div className="flex items-center gap-2.5 text-[12px] text-secondary">
      <Button
        size="sm"
        className="w-[72px]"
        data-testid="editor-play"
        onClick={() => {
          player?.toggle();
          setTimeout(() => force((n) => n + 1), 50);
        }}
      >
        {player?.isPlaying() === true ? "Pause" : "Play"}
      </Button>
      <span data-testid="editor-time" className="tabular-nums">
        {fmtTime(t)} / {fmtTime(shortDuration(short.segments))}
      </span>
    </div>
  );
}
