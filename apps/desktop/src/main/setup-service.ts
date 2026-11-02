// Keeps the latest setup report in main, so the renderer and later specs
// share one check instead of each spawning their own.
import type { SetupReport } from "@alcyo/ipc";

export class SetupService {
  private current: Promise<SetupReport> | undefined;

  constructor(private readonly runCheck: () => Promise<SetupReport>) {}

  /** The cached report, or a new one with fresh, or when the last one failed. */
  get(fresh = false): Promise<SetupReport> {
    if (fresh || this.current === undefined) {
      const run = this.runCheck();
      this.current = run;
      // A failed run isn't cached; the next call tries again.
      run.catch(() => {
        if (this.current === run) this.current = undefined;
      });
    }
    return this.current;
  }
}
