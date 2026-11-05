// Autosave for the editor: saves 300 ms after the last edit, and never more
// than 1 s after the first unsaved one (plan section 15).

export const DEBOUNCE_MS = 300;
export const MAX_WAIT_MS = 1000;

export class DraftSaver<T> {
  private pending: T | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstAt: number | undefined;
  private saving: Promise<void> = Promise.resolve();
  private generation = 0;
  private revision = 0;

  constructor(
    private readonly save: (value: T) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  /** Records an edit. The latest value wins. */
  edit(value: T): void {
    this.pending = value;
    this.revision++;
    const t = this.now();
    this.firstAt ??= t;
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.firstAt + MAX_WAIT_MS - t));
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(() => undefined), wait);
  }

  /** Saves now if there's an unsaved edit. Saves run one after another. */
  flush(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const value = this.pending;
    this.pending = undefined;
    this.firstAt = undefined;
    if (value === undefined) return this.saving;
    const generation = this.generation;
    const revision = this.revision;
    const run = this.saving
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.generation) return;
        try {
          await this.save(value);
        } catch (error) {
          if (generation === this.generation && revision === this.revision) this.pending ??= value;
          this.onError(error);
          throw error;
        }
      });
    this.saving = run;
    // A timer or an unmount may have no caller left to observe the rejection.
    void run.catch(() => undefined);
    return run;
  }

  /** Invalidates pending/queued values; an in-flight write is drained by settled(). */
  cancel(): void {
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.firstAt = undefined;
  }

  settled(): Promise<void> {
    return this.saving.catch(() => undefined);
  }
}
