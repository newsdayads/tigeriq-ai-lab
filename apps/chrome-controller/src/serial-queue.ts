export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastFinishedAt = 0;

  constructor(private readonly minGapMs: number) {}

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const waitMs = Math.max(0, this.lastFinishedAt + this.minGapMs - Date.now());
      if (waitMs > 0) await delay(waitMs);
      try {
        return await task();
      } finally {
        this.lastFinishedAt = Date.now();
      }
    };

    const result = this.tail.then(run, run);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
