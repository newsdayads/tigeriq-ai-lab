import type { ServiceName, WatchdogConfig, AuditEvent } from './types.js';
import { setTimeout as delay } from 'timers/promises';

type CheckFn = (service: ServiceName) => Promise<boolean>;
type RestartFn = (service: ServiceName) => Promise<void>;
type LoggerFn = (event: AuditEvent) => void;

export class HealthWatchdog {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly config: Required<WatchdogConfig>;

  constructor(
    private readonly check: CheckFn,
    private readonly restart: RestartFn,
    private readonly log: LoggerFn,
    config?: WatchdogConfig,
  ) {
    const defaults: Required<WatchdogConfig> = {
      intervalMs: 30_000,
      maxRetries: 5,
      baseDelayMs: 500,
      maxDelayMs: 10_000,
    };
    this.config = { ...defaults, ...config };
  }

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.runChecks(), this.config.intervalMs);
    // also run immediately
    this.runChecks();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runChecks(): Promise<void> {
    const services: ServiceName[] = ['core', 'webControl', 'codingLane', 'runtimeUpdater'];
    await Promise.all(services.map((svc) => this.checkService(svc)));
  }

  private async checkService(service: ServiceName): Promise<void> {
    const healthy = await this.check(service);
    if (healthy) return;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      const event: AuditEvent = {
        timestamp: new Date().toISOString(),
        service,
        attempt,
        status: 'retry',
        message: `Attempt ${attempt} to restart ${service}`,
      };
      this.log(event);

      try {
        await this.restart(service);
        const afterRestart = await this.check(service);
        if (afterRestart) {
          this.log({
            ...event,
            status: 'success',
            message: `${service} recovered after attempt ${attempt}`,
          });
          return;
        }
      } catch (e) {
        // ignore, will retry
      }

      const delayMs = Math.min(
        this.config.baseDelayMs * 2 ** (attempt - 1),
        this.config.maxDelayMs,
      );
      await delay(delayMs);
    }

    // final failure
    this.log({
      timestamp: new Date().toISOString(),
      service,
      attempt: this.config.maxRetries,
      status: 'failure',
      message: `${service} failed to recover after ${this.config.maxRetries} attempts`,
    });
  }
}
