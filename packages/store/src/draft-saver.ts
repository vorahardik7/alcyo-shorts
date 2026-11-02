// Autosave for the editor: saves 300 ms after the last edit, and never more
// than 1 s after the first unsaved one (plan section 15).

export const DEBOUNCE_MS = 300;
export const MAX_WAIT_MS = 1000;

export class DraftSaver<T> {
  private pending: T | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstAt: number | undefined;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly save: (value: T) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records an edit. The latest value wins. */
  edit(value: T): void {
    this.pending = value;
    const t = this.now();
    this.firstAt ??= t;
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.firstAt + MAX_WAIT_MS - t));
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  /** Saves now if there's an unsaved edit. Saves run one after another. */
  flush(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const value = this.pending;
    this.pending = undefined;
    this.firstAt = undefined;
    if (value === undefined) return this.saving;
    this.saving = this.saving.then(() => this.save(value));
    return this.saving;
  }
}
