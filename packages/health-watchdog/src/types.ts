export type ServiceName = 'core' | 'web-control' | 'coding-lane' | 'runtime-updater';

export interface ServiceConfig {
  name: ServiceName;
  port?: number;
  endpoint: string;
  checkTruth: () => Promise<boolean>;
  restart: () => Promise<void>;
}

export interface WatchdogOptions {
  intervalMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  auditLogger?: (event: WatchdogAuditEvent) => void;
}

export interface WatchdogAuditEvent {
  timestamp: string;
  service: ServiceName;
  status: 'attempt' | 'success' | 'failure' | 'blocker';
  attemptCount: number;
  message: string;
}

export interface ServiceStatus {
  name: ServiceName;
  healthy: boolean;
  lastChecked: number;
  consecutiveFailures: number;
  isRestarting: boolean;
}
