export type ServiceName = 'core' | 'webControl' | 'codingLane' | 'runtimeUpdater';

export interface WatchdogConfig {
  intervalMs?: number; // how often to run checks
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface AuditEvent {
  timestamp: string;
  service: ServiceName;
  attempt: number;
  status: 'retry' | 'success' | 'failure';
  message: string;
}
