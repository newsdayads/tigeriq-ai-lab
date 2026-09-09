import type { RecoverySummary } from '../../../packages/work-state/src/types.js';

export interface LeaseRecoveryService {
  recoverAfterRestart(at?: string): Promise<RecoverySummary>;
}

export interface LeaseRecoveryLoopOptions {
  intervalMs?: number;
  now?: () => Date;
  onSweep?: (summary: RecoverySummary) => void;
  onError?: (error: unknown) => void;
}

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 5_000;

export class LeaseRecoveryLoop {
  private timer?: ReturnType<typeof setInterval>;
  private inFlight = false;
  private readonly intervalMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly service: LeaseRecoveryService,
    private readonly options: LeaseRecoveryLoopOptions = {},
  ) {
    const requested = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (!Number.isFinite(requested) || requested < MIN_INTERVAL_MS) {
      throw new Error(`lease recovery interval must be >= ${MIN_INTERVAL_MS}ms`);
    }
    this.intervalMs = Math.floor(requested);
    this.now = options.now ?? (() => new Date());
  }

  async sweep(): Promise<RecoverySummary | undefined> {
    if (this.inFlight) return undefined;
    this.inFlight = true;
    try {
      const summary = await this.service.recoverAfterRestart(this.now().toISOString());
      this.options.onSweep?.(summary);
      return summary;
    } catch (error) {
      this.options.onError?.(error);
      return undefined;
    } finally {
      this.inFlight = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.sweep(); }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
