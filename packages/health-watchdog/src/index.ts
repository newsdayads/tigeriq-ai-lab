import { HealthWatchdog } from './watchdog.js';
import type { ServiceName, WatchdogConfig, AuditEvent } from './types.js';
import { getTruth } from '@tigeriq/runtime-truth'; // placeholder import
import { restartService } from '@tigeriq/control-plane'; // placeholder import
import { logEvent } from '@tigeriq/audit-log'; // placeholder import

// default check function using runtime truth APIs
const defaultCheck = async (service: ServiceName): Promise<boolean> => {
  const portMap: Record<ServiceName, number> = {
    core: 8795,
    webControl: 8796,
    codingLane: 8797,
    runtimeUpdater: 8798,
  };
  try {
    const truth = await getTruth(portMap[service]); // assumed signature
    return Boolean(truth);
  } catch {
    return false;
  }
};

// default restart function using control‑plane APIs
const defaultRestart = async (service: ServiceName): Promise<void> => {
  await restartService(service);
};

// default logger forwards to audit‑log package
const defaultLog = (event: AuditEvent): void => {
  logEvent(event);
};

export const createHealthWatchdog = (config?: WatchdogConfig): HealthWatchdog => {
  return new HealthWatchdog(defaultCheck, defaultRestart, defaultLog, config);
};

export const healthWatchdog = createHealthWatchdog();
