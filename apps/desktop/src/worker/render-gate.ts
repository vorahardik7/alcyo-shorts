// Background analysis waits while a render runs (plan section 23, spec 9).
// Renders call during(); the analysis engine awaits idle() before each
// background step.
export class RenderGate {
  private active = 0;
  private waiting: Array<() => void> = [];

  async during<T>(fn: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.active === 0) {
        const ready = this.waiting;
        this.waiting = [];
        for (const go of ready) go();
      }
    }
  }

  /** Resolves now when no render runs, or when the last one ends. */
  idle(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiting.push(resolve));
  }
}
