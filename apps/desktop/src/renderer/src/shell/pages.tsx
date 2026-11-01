import { Link, useParams } from "@tanstack/react-router";
import { BAD_LINK_MESSAGE } from "@alcyo/schema";

function HeaderPill({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-[1] flex justify-center">
      <div
        data-testid="thread-header"
        className="no-drag pointer-events-auto max-w-[60%] truncate rounded-full bg-bubble-claude px-4 py-1.5 text-small shadow ring-1 ring-hairline"
      >
        {label}
      </div>
    </div>
  );
}

function Composer({ placeholder }: { placeholder: string }) {
  return (
    <form
      className="mx-auto mb-6 flex w-full max-w-3xl items-center gap-2 rounded-full bg-bubble-claude px-2 py-2 ring-1 ring-hairline"
      onSubmit={(e) => e.preventDefault()}
    >
      <button
        type="button"
        aria-label="Attach a file or paste a link"
        className="grid size-9 place-items-center rounded-full text-secondary hover:bg-bubble-user hover:text-text"
      >
        +
      </button>
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-secondary"
      />
      <button
        type="submit"
        disabled
        aria-label="Send"
        className="grid size-9 place-items-center rounded-full bg-text text-bg disabled:opacity-30"
      >
        ↑
      </button>
    </form>
  );
}

function ThreadFrame({ header, children }: { header: string; children: React.ReactNode }) {
  return (
    <section className="flex h-full flex-col">
      <HeaderPill label={header} />
      <div className="flex flex-1 items-center justify-center px-8">{children}</div>
      <div className="px-6">
        <Composer placeholder={`Message ${header}`} />
      </div>
    </section>
  );
}

export function EmptyThread() {
  return (
    <ThreadFrame header="Alcyo">
      <div data-testid="empty-thread" className="max-w-md text-center">
        <p className="text-body">Paste a stream link or drop in a recording to start.</p>
        <p className="mt-2 text-small text-secondary">Everything is processed on this computer.</p>
      </div>
    </ThreadFrame>
  );
}

export function StreamPlaceholder() {
  const { streamId } = useParams({ strict: false });
  return (
    <ThreadFrame header={streamId ?? "Stream"}>
      <p data-testid="stream-placeholder" className="text-secondary">
        This stream isn&apos;t in the app yet.
      </p>
    </ThreadFrame>
  );
}

export function PlainPage({ title, body }: { title: string; body: string }) {
  return (
    <section className="mx-auto w-full max-w-2xl overflow-y-auto px-8 pt-16 pb-10">
      <h1 className="text-[22px] font-semibold">{title}</h1>
      <p className="mt-3 text-secondary">{body}</p>
    </section>
  );
}

export function NotFound() {
  return (
    <section className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <p data-testid="not-found">{BAD_LINK_MESSAGE}</p>
      <Link to="/" className="text-small text-secondary underline hover:text-text">
        Go to the start
      </Link>
    </section>
  );
}
