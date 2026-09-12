import { createHash } from 'crypto';

export interface Incident {
  id: string;
  type: string;
  message: string;
  status: 'ACTIVE' | 'BLOCKED_TECHNICAL';
  firstSeen: number;
  lastSeen: number;
}

export interface SupervisorState {
  lastScan: number;
  lastDeepScan: number;
  activeIncidents: Record<string, Incident>;
  retryCounts: Record<string, { count: number; firstAttempt: number }>;
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
}

export const runtimeState: { supervisor: SupervisorState } = {
  supervisor: {
    lastScan: 0,
    lastDeepScan: 0,
    activeIncidents: {},
    retryCounts: {},
  },
};

export function checkCoreHealth(): HealthCheckResult {
  return { healthy: true };
}

export function checkWebControlHealth(): HealthCheckResult {
  return { healthy: true };
}

export function checkQueueHealth(): HealthCheckResult {
  return { healthy: true };
}

export function dispatchWorkItem(item: { id: string; type: string; payload: any }): void {
  // No-op by default, mocked or overridden
}

export function updateWebControlStatus(status: any): void {
  // No-op by default, mocked or overridden
}

export class NV21Supervisor {
  #lightIntervalId?: NodeJS.Timeout;
  #deepIntervalId?: NodeJS.Timeout;
  #incidentMap = new Map<string, Incident>();
  #retryCounts = new Map<string, { count: number; firstAttempt: number }>();
  #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
    const state = runtimeState.supervisor;
    if (state && state.activeIncidents) {
      for (const [k, v] of Object.entries(state.activeIncidents)) {
        this.#incidentMap.set(k, v);
      }
    }
    if (state && state.retryCounts) {
      for (const [k, v] of Object.entries(state.retryCounts)) {
        this.#retryCounts.set(k, v);
      }
    }
  }

  start(): void {
    if (!this.#lightIntervalId) {
      this.#lightIntervalId = setInterval(() => {
        this.audit(false).catch(() => {});
      }, 5 * 60 * 1000);
    }
    if (!this.#deepIntervalId) {
      this.#deepIntervalId = setInterval(() => {
        this.audit(true).catch(() => {});
      }, 30 * 60 * 1000);
    }
  }

  stop(): void {
    if (this.#lightIntervalId) {
      clearInterval(this.#lightIntervalId);
      this.#lightIntervalId = undefined;
    }
    if (this.#deepIntervalId) {
      clearInterval(this.#deepIntervalId);
      this.#deepIntervalId = undefined;
    }
  }

  async audit(deep = false): Promise<void> {
    const currentTime = this.#now();
    const results: Array<{ type: string; result: HealthCheckResult }> = [
      { type: 'core', result: checkCoreHealth() },
      { type: 'webControl', result: checkWebControlHealth() },
    ];

    if (deep) {
      results.push({ type: 'queue', result: checkQueueHealth() });
    }

    const detectedIncidents: Array<{ type: string; message: string }> = [];
    for (const item of results) {
      if (!item.result.healthy) {
        detectedIncidents.push({
          type: item.type,
          message: item.result.message ?? `${item.type} service failure`,
        });
      }
    }

    const currentActive: Record<string, Incident> = {};
    const currentRetries: Record<string, { count: number; firstAttempt: number }> = {};

    for (const inc of detectedIncidents) {
      const hashInput = `${inc.type}:${inc.message}`;
      const hash = createHash('sha256').update(hashInput).digest('hex');

      let incident = this.#incidentMap.get(hash);
      if (!incident) {
        incident = {
          id: hash,
          type: inc.type,
          message: inc.message,
          status: 'ACTIVE',
          firstSeen: currentTime,
          lastSeen: currentTime,
        };
        this.#incidentMap.set(hash, incident);

        let retryInfo = this.#retryCounts.get(hash);
        if (!retryInfo) {
          retryInfo = { count: 0, firstAttempt: currentTime };
          this.#retryCounts.set(hash, retryInfo);
        }

        if (retryInfo.count >= 3) {
          incident.status = 'BLOCKED_TECHNICAL';
        } else {
          retryInfo.count += 1;
          dispatchWorkItem({
            id: hash,
            type: inc.type,
            payload: { message: inc.message, retryCount: retryInfo.count },
          });
        }
      } else {
        incident.lastSeen = currentTime;
      }

      if (incident.status === 'ACTIVE') {
        const retryInfo = this.#retryCounts.get(hash);
        if (retryInfo && currentTime - retryInfo.firstAttempt <= 60 * 60 * 1000 && retryInfo.count >= 3) {
          incident.status = 'BLOCKED_TECHNICAL';
        }
      }

      currentActive[hash] = incident;
      const retryInfo = this.#retryCounts.get(hash);
      if (retryInfo) {
        currentRetries[hash] = retryInfo;
      }
    }

    for (const [hash, incident] of this.#incidentMap.entries()) {
      if (!detectedIncidents.some(d => createHash('sha256').update(`${d.type}:${d.message}`).digest('hex') === hash)) {
        // Resolved or not present in current scan, keep tracking or drop if needed. We keep active incidents in truth store if desired or update.
      }
    }

    runtimeState.supervisor.lastScan = currentTime;
    if (deep) {
      runtimeState.supervisor.lastDeepScan = currentTime;
    }
    runtimeState.supervisor.activeIncidents = Object.fromEntries(this.#incidentMap);
    runtimeState.supervisor.retryCounts = Object.fromEntries(this.#retryCounts);

    updateWebControlStatus(runtimeState.supervisor);
  }
}
