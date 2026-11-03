// Settings > Profile (plan section 13): edit the profile, write the style from
// past shorts, and import or export templates.
import type { CreatorProfile, GoodMoment, Platform } from "@alcyo/schema";
import { HOOK_FOR_CAPTION } from "@alcyo/schema";
import { useState } from "react";
import { plainError } from "../streams/store";
import { Button, ButtonLink } from "../ui/Button";
import { Card, Row, Spinner, StateBadge } from "../ui/parts";
import { toast } from "../ui/toast";
import { CaptionLook } from "./CaptionLook";
import { useProfile } from "./store";

const MOMENTS: Array<[GoodMoment, string]> = [
  ["funny", "Funny"],
  ["skill", "Skill"],
  ["rage", "Rage"],
  ["wholesome", "Wholesome"],
  ["story", "Story"],
  ["info", "Info"],
  ["close-call", "Close calls"],
];
const PLATFORMS: Array<[Platform, string]> = [
  ["tiktok", "TikTok"],
  ["youtube-shorts", "YouTube Shorts"],
  ["reels", "Reels"],
];

const box =
  "rounded-xl bg-bubble-claude px-3 py-2 text-[14px] outline-none ring-1 ring-hairline placeholder:text-tertiary focus-visible:ring-2 focus-visible:ring-unread";
const field = `${box} w-full`;

const sec = (ms: number | undefined) => (ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`);

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-8 rounded-full px-3 text-[14px] outline-none ring-1 transition-colors focus-visible:ring-2 focus-visible:ring-unread ${
        on ? "bg-text text-bg ring-transparent" : "text-secondary ring-hairline hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

function ProfileForm({ profile }: { profile: CreatorProfile }) {
  const view = useProfile((s) => s.view);
  const setView = useProfile((s) => s.set);
  const [draft, setDraft] = useState(profile);
  const [titles, setTitles] = useState(profile.exampleTitles.join("\n"));
  const [avoid, setAvoid] = useState(profile.avoid.join("\n"));
  const [saving, setSaving] = useState(false);
  const [writing, setWriting] = useState(false);

  const next: CreatorProfile = {
    ...draft,
    exampleTitles: lines(titles).slice(0, 5),
    avoid: lines(avoid).slice(0, 20),
  };
  const dirty = JSON.stringify(next) !== JSON.stringify(profile);
  const lengthBad = next.lengthMs.min > next.lengthMs.max || next.lengthMs.min < 5000;
  const set = (patch: Partial<CreatorProfile>) => setDraft((d) => ({ ...d, ...patch }));
  const captions = view?.captionPresets ?? [];
  const hooks = view?.hookPresets ?? [];

  const save = () => {
    setSaving(true);
    window.alcyo
      .invoke("profile:save", { profile: next })
      .then(
        (v) => {
          setView(v);
          toast("Profile saved", "New shorts use it from now on.");
        },
        (e: unknown) => toast("The profile wasn't saved", plainError(e)),
      )
      .finally(() => setSaving(false));
  };

  return (
    <>
      <Card
        testId="profile-card"
        title="Profile"
        description="Goes into every request to the agent as text."
        actions={
          <>
            <ButtonLink to="/onboarding" size="sm" variant="ghost">
              Redo the interview
            </ButtonLink>
            <Button
              size="sm"
              variant="primary"
              disabled={!dirty || saving || lengthBad}
              data-testid="profile-save"
              onClick={save}
            >
              {saving && <Spinner size={12} />}
              Save
            </Button>
          </>
        }
      >
        <Row label="Name">
          <input
            className={field}
            value={draft.name}
            maxLength={80}
            placeholder="Your name or channel"
            data-testid="profile-name"
            onChange={(e) => set({ name: e.target.value })}
          />
        </Row>
        <Row label="Streams">
          <input
            className={field}
            value={draft.streams}
            maxLength={300}
            data-testid="profile-streams"
            onChange={(e) => set({ streams: e.target.value })}
          />
        </Row>
        <Row label="Viewers">
          <input
            className={field}
            value={draft.audience}
            maxLength={300}
            placeholder="Who watches"
            onChange={(e) => set({ audience: e.target.value })}
          />
        </Row>
        <Row label="Good moments">
          <div className="flex flex-wrap gap-1.5">
            {MOMENTS.map(([id, label]) => (
              <Toggle
                key={id}
                label={label}
                on={draft.goodMoments.includes(id)}
                onClick={() => set({ goodMoments: toggle(draft.goodMoments, id) })}
              />
            ))}
          </div>
        </Row>
        <Row label="Length">
          <span className="flex items-center gap-2">
            <input
              className={`${box} w-20 tabular-nums`}
              type="number"
              min={5}
              max={180}
              aria-label="Shortest, in seconds"
              data-testid="profile-min"
              value={Math.round(draft.lengthMs.min / 1000)}
              onChange={(e) =>
                set({
                  lengthMs: {
                    ...draft.lengthMs,
                    min: Math.max(0, Number(e.target.value) || 0) * 1000,
                  },
                })
              }
            />
            <span className="text-secondary">to</span>
            <input
              className={`${box} w-20 tabular-nums`}
              type="number"
              min={5}
              max={180}
              aria-label="Longest, in seconds"
              data-testid="profile-max"
              value={Math.round(draft.lengthMs.max / 1000)}
              onChange={(e) =>
                set({
                  lengthMs: {
                    ...draft.lengthMs,
                    max: Math.max(0, Number(e.target.value) || 0) * 1000,
                  },
                })
              }
            />
            <span className="text-secondary">seconds</span>
            {lengthBad && (
              <span className="text-[13px] text-bad">Use 5 s or more, shortest first.</span>
            )}
          </span>
        </Row>
        <Row label="Title rules">
          <input
            className={field}
            value={draft.titleRules}
            maxLength={500}
            onChange={(e) => set({ titleRules: e.target.value })}
          />
        </Row>
        <Row label="Example titles">
          <textarea
            className={`${field} min-h-16`}
            value={titles}
            placeholder="One per line, up to 5"
            onChange={(e) => setTitles(e.target.value)}
          />
        </Row>
        <Row label="Keep out">
          <textarea
            className={`${field} min-h-16`}
            value={avoid}
            placeholder="Words, topics or people, one per line"
            onChange={(e) => setAvoid(e.target.value)}
          />
        </Row>
        <Row label="Posts to">
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map(([id, label]) => (
              <Toggle
                key={id}
                label={label}
                on={draft.platforms.includes(id)}
                onClick={() => set({ platforms: toggle(draft.platforms, id) })}
              />
            ))}
          </div>
        </Row>
        <div className="border-b border-hairline px-5 py-3">
          <p className="mb-2 text-[14px] text-secondary">Caption look</p>
          <div className="flex flex-wrap gap-1">
            {captions.map((c) => (
              <CaptionLook
                key={c.id}
                testId={`profile-look-${c.id}`}
                caption={c}
                hook={hooks.find((h) => h.id === draft.hookPresetId)}
                selected={draft.captionPresetId === c.id}
                onPick={() =>
                  set({
                    captionPresetId: c.id,
                    hookPresetId: HOOK_FOR_CAPTION[c.id] ?? draft.hookPresetId,
                  })
                }
              />
            ))}
          </div>
        </div>
        <Row label="Hook">
          <select
            className={`${box} w-56`}
            value={draft.hookPresetId}
            aria-label="Hook look"
            onChange={(e) => set({ hookPresetId: e.target.value })}
          >
            {hooks.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Row>
      </Card>

      <Card
        testId="style-card"
        title="Style"
        description="How you edit, written from your past shorts. Edit it if it's off."
        actions={
          <Button
            size="sm"
            disabled={writing || (view?.samples.length ?? 0) === 0}
            data-testid="style-write"
            onClick={() => {
              setWriting(true);
              window.alcyo
                .invoke("style:write", {})
                .then(setView, (e: unknown) => toast("The style wasn't written", plainError(e)))
                .finally(() => setWriting(false));
            }}
          >
            {writing && <Spinner size={12} />}
            {draft.style.summary.length > 0 ? "Write it again" : "Write from past shorts"}
          </Button>
        }
      >
        <div className="px-5 py-3">
          <textarea
            className={`${field} min-h-20`}
            data-testid="style-summary"
            maxLength={800}
            placeholder="Add past shorts below, then write the summary."
            value={draft.style.summary}
            onChange={(e) => set({ style: { ...draft.style, summary: e.target.value } })}
          />
        </div>
        <Row label="Targets">
          <span className="text-secondary tabular-nums" data-testid="style-numbers">
            First word {sec(draft.style.firstWordMs)} · {draft.style.wordsPerSecond ?? "—"} words/s
            · a cut every {sec(draft.style.cutEveryMs)} · from {draft.style.sampleCount} shorts
          </span>
        </Row>
      </Card>
    </>
  );
}

function PastShorts() {
  const view = useProfile((s) => s.view);
  const setView = useProfile((s) => s.set);
  const samples = view?.samples ?? [];
  const pending = view?.pending ?? [];
  return (
    <Card
      testId="samples-card"
      title="Past shorts"
      description={`Shorts you've posted, analyzed on this computer. The videos aren't copied; only measurements are kept. ${samples.length} of 50.`}
      actions={
        <Button
          size="sm"
          data-testid="samples-add"
          onClick={() =>
            void window.alcyo.invoke("samples:add", {}).then(
              (out) => {
                if ("added" in out && out.skipped > 0)
                  toast("Only 50 past shorts fit", `${out.skipped} weren't added.`);
              },
              (e: unknown) => toast("Couldn't add those", plainError(e)),
            )
          }
        >
          Add past shorts
        </Button>
      }
    >
      {samples.length === 0 && pending.length === 0 && (
        <p className="px-5 py-3 text-[14px] text-tertiary">None yet.</p>
      )}
      {samples.map((s) => (
        <Row
          key={s.sampleId}
          label={s.fileName}
          aside={
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${s.fileName}`}
              onClick={() =>
                void window.alcyo
                  .invoke("samples:remove", { sampleId: s.sampleId })
                  .then(setView, (e: unknown) => toast("Couldn't remove it", plainError(e)))
              }
            >
              Remove
            </Button>
          }
        >
          <span className="text-secondary tabular-nums" data-testid="sample-row">
            {sec(s.measures.lengthMs)} · first word{" "}
            {s.measures.firstWordMs === null ? "—" : sec(s.measures.firstWordMs)} ·{" "}
            {s.measures.wordsPerSecond ?? "—"} words/s · a cut every {sec(s.measures.cutEveryMs)}
          </span>
        </Row>
      ))}
      {pending.map((p) => (
        <Row
          key={p.sampleId}
          label={p.fileName}
          aside={
            p.state === "failed" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void window.alcyo
                    .invoke("samples:remove", { sampleId: p.sampleId })
                    .then(setView, () => undefined)
                }
              >
                Dismiss
              </Button>
            ) : undefined
          }
        >
          <span
            className="flex items-center gap-2 text-[14px] text-secondary"
            data-testid="sample-pending"
          >
            {p.state === "failed" ? (
              <>
                <StateBadge state="fail" />
                {p.message}
              </>
            ) : (
              <>
                <Spinner size={12} />
                {p.state === "analyzing" ? "Analyzing" : "Waiting"}
              </>
            )}
          </span>
        </Row>
      ))}
    </Card>
  );
}

function Templates() {
  const view = useProfile((s) => s.view);
  const imported = [...(view?.captionPresets ?? []), ...(view?.hookPresets ?? [])].filter(
    (p) => p.origin !== "builtin",
  );
  return (
    <Card
      testId="templates-card"
      title="Templates"
      description="Import an Alcyo template or an .ass file's styles. Export your looks to share with an editor."
      actions={
        <>
          <Button
            size="sm"
            data-testid="template-import"
            onClick={() =>
              void window.alcyo.invoke("template:import", {}).then(
                (out) => {
                  if ("cancelled" in out) return;
                  toast(
                    `Added ${out.added} ${out.added === 1 ? "look" : "looks"}`,
                    out.notes.join(" ") || undefined,
                  );
                },
                (e: unknown) => toast("Couldn't import that", plainError(e)),
              )
            }
          >
            Import
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="template-export"
            onClick={() =>
              void window.alcyo.invoke("template:export", {}).then(
                (out) => {
                  if ("path" in out) toast("Template exported", out.path);
                },
                (e: unknown) => toast("Couldn't export", plainError(e)),
              )
            }
          >
            Export
          </Button>
        </>
      }
    >
      {imported.length === 0 ? (
        <p className="px-5 py-3 text-[14px] text-tertiary">No imported looks yet.</p>
      ) : (
        imported.map((p) => (
          <Row key={p.id} label={p.name}>
            <span className="text-secondary">
              {"highlightColor" in p ? "Caption" : "Hook"} · {p.font} · from{" "}
              {p.origin === "ass" ? ".ass file" : "template"}
            </span>
          </Row>
        ))
      )}
    </Card>
  );
}

export function ProfileSettings() {
  const view = useProfile((s) => s.view);
  const error = useProfile((s) => s.error);
  if (view === null) {
    return <p className="text-[14px] text-secondary">{error ?? "Loading…"}</p>;
  }
  return (
    <>
      {view.profile === null ? (
        <Card
          testId="profile-empty"
          title="No creator profile yet"
          description={`${view.agent ?? "The agent"} asks a few questions about your streams and your shorts. The answers become your profile, which goes into every request as text.`}
          actions={
            <ButtonLink to="/onboarding" size="sm" variant="primary" data-testid="profile-start">
              Start the interview
            </ButtonLink>
          }
        />
      ) : (
        <ProfileForm key={JSON.stringify(view.profile)} profile={view.profile} />
      )}
      <PastShorts />
      <Templates />
      <p className="px-1 text-[13px] text-tertiary">
        Only text and numbers go to the agent: your answers, the summary, the measurements and the
        opening words of past shorts. Never video, audio or images.
      </p>
    </>
  );
}
