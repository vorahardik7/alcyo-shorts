// The onboarding thread (plan section 13): the agent asks up to 8 questions,
// each one skippable, then the creator picks a caption look. The answers go
// to the agent as text; the profile is saved in userData.
import type { InterviewState } from "@alcyo/ipc";
import { HOOK_FOR_CAPTION } from "@alcyo/schema";
import { useEffect, useRef, useState } from "react";
import { usePageTitle } from "../nav/navigation";
import { HeaderPill } from "../shell/pages";
import { plainError } from "../streams/store";
import { Button, ButtonLink } from "../ui/Button";
import { ArrowUpIcon } from "../ui/icons";
import { Spinner } from "../ui/parts";
import { toast } from "../ui/toast";
import { CaptionLook } from "./CaptionLook";
import { useProfile } from "./store";

type Pending = { kind: "start" } | { kind: "answer"; answer: string | null; finishNow: boolean };

function Bubble({
  mine = false,
  children,
  testId,
}: {
  mine?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={testId}>
      <div
        className={`max-w-[75%] rounded-bubble px-5 py-3 text-[15px] leading-relaxed select-text ${
          mine ? "bg-bubble-user" : "bg-bubble-claude"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function Onboarding() {
  usePageTitle("Creator profile");
  const view = useProfile((s) => s.view);
  const setView = useProfile((s) => s.set);
  const [state, setState] = useState<InterviewState | null>(null);
  const [busy, setBusy] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const [skippedAll, setSkippedAll] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const agent = view?.agent ?? "the agent";

  useEffect(() => {
    window.alcyo
      .invoke("interview:get", {})
      .then(setState, (e: unknown) => toast("Couldn't load the interview", plainError(e)));
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [state?.turns.length, state?.phase, busy]);

  const run = (p: Pending) => {
    setBusy(p);
    setFailed(null);
    const call =
      p.kind === "start"
        ? window.alcyo.invoke("interview:start", {})
        : window.alcyo.invoke("interview:answer", {
            answer: p.answer,
            ...(p.finishNow ? { finishNow: true } : {}),
          });
    call
      .then(
        (next) => {
          setState(next);
          if (next.error !== null) setFailed(p);
        },
        (e: unknown) => {
          setFailed(p);
          toast("The interview stopped", plainError(e));
        },
      )
      .finally(() => setBusy(null));
  };

  const pick = (captionPresetId: string) => {
    window.alcyo.invoke("interview:finish", { captionPresetId }).then(
      (next) => {
        setView(next);
        setState((s) => (s === null ? s : { ...s, phase: "done" }));
      },
      (e: unknown) => toast("The profile wasn't saved", plainError(e)),
    );
  };

  const phase = state === null ? null : skippedAll && state.phase !== "done" ? "look" : state.phase;
  const asking = phase === "asking" && state?.question != null && busy === null;
  const send = () => {
    if (!asking || text.trim().length === 0) return;
    run({ kind: "answer", answer: text.trim(), finishNow: false });
    setText("");
  };
  const captions = view?.captionPresets ?? [];
  const hooks = view?.hookPresets ?? [];

  return (
    <section data-testid="onboarding" className="relative flex h-full flex-col">
      <div className="drag absolute inset-x-0 top-0 h-12" aria-hidden />
      <HeaderPill label="Creator profile" />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-20 pb-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <Bubble>
            A few questions about your streams and your shorts.{" "}
            {agent === "the agent" ? "The agent" : agent} asks them; the answers become your
            profile, which goes into every request as text. Skip anything you like.
          </Bubble>
          {phase === "start" && busy === null && (
            <div className="flex gap-2 pl-1">
              <Button
                variant="primary"
                size="sm"
                data-testid="interview-start"
                onClick={() => run({ kind: "start" })}
              >
                Start
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="interview-skip-all"
                onClick={() => setSkippedAll(true)}
              >
                Skip the interview
              </Button>
            </div>
          )}
          {state?.turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Bubble>{t.question}</Bubble>
              <Bubble mine testId="interview-answer">
                {t.answer ?? <span className="text-tertiary">Skipped</span>}
              </Bubble>
            </div>
          ))}
          {phase === "asking" && state?.question != null && (
            <div className="flex flex-col gap-2">
              <Bubble testId="interview-question">{state.question.text}</Bubble>
              {busy === null && (
                <div className="flex flex-wrap gap-2 pl-1">
                  {state.question.chips.map((chip) => (
                    <Button
                      key={chip}
                      size="sm"
                      data-testid="interview-chip"
                      onClick={() => run({ kind: "answer", answer: chip, finishNow: false })}
                    >
                      {chip}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="interview-skip"
                    onClick={() => run({ kind: "answer", answer: null, finishNow: false })}
                  >
                    Skip
                  </Button>
                  {state.turns.length >= 2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="interview-finish"
                      onClick={() => {
                        run({
                          kind: "answer",
                          answer: text.trim().length > 0 ? text.trim() : null,
                          finishNow: true,
                        });
                        setText("");
                      }}
                    >
                      Finish now
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          {busy?.kind === "answer" && (
            // Shown right away; the agent's reply takes a few seconds.
            <Bubble mine testId="interview-answer">
              {busy.answer ?? <span className="text-tertiary">Skipped</span>}
            </Bubble>
          )}
          {busy !== null && (
            <div
              className="flex items-center gap-3 pl-2 text-[14px] text-secondary"
              data-testid="interview-thinking"
            >
              <Spinner size={14} />
              Waiting for {agent}…
            </div>
          )}
          {failed !== null && busy === null && state?.error != null && (
            <div
              className="flex items-center gap-3 rounded-bubble bg-bad/8 px-5 py-3 ring-1 ring-bad/20"
              data-testid="interview-error"
            >
              <p className="min-w-0 flex-1 text-[14px]">{state.error}</p>
              <Button size="sm" onClick={() => run(failed)}>
                Try again
              </Button>
            </div>
          )}
          {phase === "look" && (
            <div className="flex flex-col gap-3" data-testid="interview-look">
              <Bubble>
                Last one: pick a caption look. You can change it, or import your own template, in
                Settings.
              </Bubble>
              <div className="flex flex-wrap gap-2">
                {captions
                  .filter((c) => c.origin === "builtin")
                  .map((c) => (
                    <CaptionLook
                      key={c.id}
                      testId={`look-${c.id}`}
                      caption={c}
                      hook={hooks.find((h) => h.id === HOOK_FOR_CAPTION[c.id])}
                      onPick={() => pick(c.id)}
                    />
                  ))}
              </div>
            </div>
          )}
          {phase === "done" && (
            <div className="flex flex-col gap-3" data-testid="interview-done">
              <Bubble>
                Your profile is saved. Add a few shorts you&apos;ve posted so new ones match your
                style. Only their measurements are kept.
              </Bubble>
              <div className="flex flex-wrap gap-2 pl-1">
                <Button
                  size="sm"
                  variant="primary"
                  data-testid="done-add-shorts"
                  onClick={() =>
                    void window.alcyo.invoke("samples:add", {}).then(
                      (out) => {
                        if ("added" in out)
                          toast(
                            `Adding ${out.added} past shorts`,
                            "They're analyzed on this computer. See them in Settings > Profile.",
                          );
                      },
                      (e: unknown) => toast("Couldn't add those", plainError(e)),
                    )
                  }
                >
                  Add past shorts
                </Button>
                <ButtonLink to="/settings/profile" size="sm" data-testid="done-open-profile">
                  Open profile
                </ButtonLink>
                <ButtonLink to="/" size="sm" variant="ghost">
                  Start a stream
                </ButtonLink>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="interview-redo"
                  onClick={() => run({ kind: "start" })}
                >
                  Redo the interview
                </Button>
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="px-6">
        <form
          className="mx-auto mb-6 flex w-full max-w-3xl items-center gap-2 rounded-full bg-bubble-claude py-2 pr-2 pl-5 ring-1 ring-hairline focus-within:ring-[#ffffff2e]"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            data-testid="interview-input"
            aria-label="Your answer"
            placeholder={asking ? "Type your answer" : "Answers go here once a question is asked"}
            disabled={!asking}
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-tertiary disabled:opacity-50"
          />
          <button
            type="submit"
            aria-label="Send"
            title="Send"
            data-testid="interview-send"
            disabled={!asking || text.trim().length === 0}
            className="grid size-9 place-items-center rounded-full bg-text text-bg outline-none focus-visible:ring-2 focus-visible:ring-unread disabled:opacity-25"
          >
            <ArrowUpIcon size={18} strokeWidth={2.2} />
          </button>
        </form>
      </div>
    </section>
  );
}
