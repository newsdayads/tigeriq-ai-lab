import { ServiceConfig, WatchdogOptions, ServiceName, ServiceStatus, WatchdogAuditEvent } from './types.js';

export class HealthWatchdog {
  private services: Map<ServiceName, ServiceConfig> = new Map();
  private statuses: Map<ServiceName, ServiceStatus> = new Map();
  private intervalMs: number;
  private maxRetries: number;
  private baseBackoffMs: number;
  private auditLogger: (event: WatchdogAuditEvent) => void;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(services: ServiceConfig[], options: WatchdogOptions = {}) {
    this.intervalMs = options.intervalMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.auditLogger = options.auditLogger ?? ((event) => {
      console.log(`[HealthWatchdog Audit] [${event.timestamp}] ${event.service} (${event.status}): ${event.message}`);
    });

    for (const svc of services) {
      this.services.set(svc.name, svc);
      this.statuses.set(svc.name, {
        name: svc.name,
        healthy: true,
        lastChecked: Date.now(),
        consecutiveFailures: 0,
        isRestarting: false,
      });
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.checkAllServices().catch((err) => {
        console.error('[HealthWatchdog] Error during check cycle:', err);
      });
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  public async checkAllServices(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const serviceName of this.services.keys()) {
      promises.push(this.checkService(serviceName));
    }
    await Promise.all(promises);
  }

  public async checkService(name: ServiceName): Promise<boolean> {
    const svc = this.services.get(name);
    const status = this.statuses.get(name);
    if (!svc || !status) return false;
    if (status.isRestarting) return status.healthy;

    let isHealthy = false;
    try {
      isHealthy = await svc.checkTruth();
    } catch (e) {
      isHealthy = false;
    }

    status.lastChecked = Date.now();

    if (isHealthy) {
      status.healthy = true;
      status.consecutiveFailures = 0;
      return true;
    } else {
      status.healthy = false;
      status.consecutiveFailures++;
      this.emitAudit(name, 'failure', status.consecutiveFailures, `Service truth check failed. Failure count: ${status.consecutiveFailures}`);
      
      // Trigger bounded retry with exponential back-off and restart if threshold reached
      if (!status.isRestarting) {
        this.handleServiceFailure(name, svc, status).catch((err) => {
          console.error(`[HealthWatchdog] Failed recovery handling for ${name}:`, err);
        });
      }
      return false;
    }
  }

  private async handleServiceFailure(name: ServiceName, svc: ServiceConfig, status: ServiceStatus): Promise<void> {
    status.isRestarting = true;

    let attempt = 0;
    let recovered = false;

    while (attempt < this.maxRetries && !recovered && this.isRunning) {
      attempt++;
      const backoff = this.baseBackoffMs * Math.pow(2, attempt - 1);
      
      this.emitAudit(name, 'attempt', attempt, `Attempting restart and recovery (Attempt ${attempt}/${this.maxRetries}) after backoff ${backoff}ms`);
      
      await new Promise((resolve) => setTimeout(resolve, backoff));

      try {
        await svc.restart();
        // Verify truth after restart
        const healthyNow = await svc.checkTruth();
        if (healthyNow) {
          recovered = true;
          status.healthy = true;
          status.consecutiveFailures = 0;
          this.emitAudit(name, 'success', attempt, `Service successfully restarted and verified healthy.`);
        } else {
          this.emitAudit(name, 'failure', attempt, `Service restarted but truth check still failing on attempt ${attempt}.`);
        }
      } catch (err: any) {
        this.emitAudit(name, 'failure', attempt, `Restart attempt ${attempt} threw error: ${err?.message || err}`);
      }
    }

    if (!recovered) {
      this.emitAudit(name, 'blocker', attempt, `CRITICAL: Service ${name} failed to recover after ${this.maxRetries} bounded retry attempts. Marked as blocker.`);
    }

    status.isRestarting = false;
  }

  private emitAudit(service: ServiceName, status: WatchdogAuditEvent['status'], attemptCount: number, message: string): void {
    const event: WatchdogAuditEvent = {
      timestamp: new Date().toISOString(),
      service,
      status,
      attemptCount,
      message,
    };
    this.auditLogger(event);
  }

  public getStatus(name: ServiceName): ServiceStatus | undefined {
    return this.statuses.get(name);
  }
}
