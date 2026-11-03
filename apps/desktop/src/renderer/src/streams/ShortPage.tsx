// /s/<stream>/short/<short>/v/<n>/edit: one version, large, with the same
// player as the cards. The editing tools (timeline, transcript, captions,
// reframe) arrive with spec 11; until then this is the version's preview.
import { formatAppLink, shortDuration } from "@alcyo/schema";
import { Link, useParams } from "@tanstack/react-router";
import { BackButton } from "../nav/BackButton";
import { usePageTitle } from "../nav/navigation";
import { Button } from "../ui/Button";
import { LinkIcon } from "../ui/icons";
import { Spinner } from "../ui/parts";
import { clock } from "./clips";
import { ShortPlayer } from "./player";
import { startRender } from "./renders";
import { copyLink, usePreview } from "./shorts";

export function ShortPage() {
  const { streamId = "", shortId = "", version = "" } = useParams({ strict: false });
  const n = Number(version);
  const p = usePreview(streamId, {
    shortId,
    ...(Number.isInteger(n) && n > 0 ? { version: n } : {}),
  });
  const title = p !== null && p !== "missing" ? p.version.short.title : "Short";
  usePageTitle(title);

  return (
    <section data-testid="short-page" className="relative flex h-full flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-hairline px-4">
        <BackButton />
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h1>
      </header>
      {p === null ? (
        <div className="grid flex-1 place-items-center">
          <Spinner />
        </div>
      ) : p === "missing" ? (
        <div className="grid flex-1 place-items-center px-8 text-center text-secondary">
          <div>
            <p data-testid="short-missing">That version isn&apos;t in this stream.</p>
            <Link
              to="/s/$streamId"
              params={{ streamId }}
              className="mt-3 inline-block text-[14px] text-text underline-offset-2 hover:underline"
            >
              Open the stream
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-8 overflow-y-auto px-8 py-6">
          <div className="mx-auto flex w-full max-w-4xl flex-wrap items-start justify-center gap-8">
            <ShortPlayer
              preview={p}
              playKey={`page-${p.version.shortId}-${p.version.version}`}
              className="w-[min(100%,22rem)] shrink-0"
            />
            <div className="min-w-[16rem] flex-1 space-y-4 pt-1">
              <div>
                <p className="text-[12px] text-tertiary tabular-nums">
                  v{p.version.version} · {p.version.createdBy === "claude" ? "Agent" : "You"} ·{" "}
                  {clock(p.version.short.segments[0]!.srcIn)} ·{" "}
                  {Math.round(shortDuration(p.version.short.segments) / 1000)} s
                </p>
                <h2 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight">
                  {p.version.short.title}
                </h2>
                {p.version.short.hook !== undefined && (
                  <p className="mt-2 text-[15px] text-secondary">“{p.version.short.hook.text}”</p>
                )}
                <p className="mt-2 text-[14px] leading-relaxed text-tertiary select-text">
                  {p.version.short.reason}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="page-render"
                  onClick={() => startRender(streamId, p.version.shortId, p.version.version)}
                >
                  Render
                </Button>
                <Button
                  size="sm"
                  data-testid="page-copy-link"
                  onClick={() =>
                    copyLink(
                      formatAppLink({
                        to: "short",
                        streamId,
                        shortId: p.version.shortId,
                        version: p.version.version,
                        edit: true,
                      }),
                    )
                  }
                >
                  <LinkIcon size={14} />
                  Copy link
                </Button>
              </div>
              <p className="rounded-xl bg-card/60 px-4 py-3 text-[13px] leading-snug text-tertiary ring-1 ring-hairline">
                Trimming, caption edits and reframing open here next. For now, ask for changes in
                the stream&apos;s chat, or reply to the card.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
