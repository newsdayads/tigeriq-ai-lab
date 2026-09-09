import type { TaskPacket, WorkerNodeRecord } from './index.js';

export interface AndroidResourceRegistration {
  nodeId: string;
  deviceId: string;
  platform: string;
  agentVersion: string;
  capabilities: string[];
  lastHeartbeatAt: string;
  status?: 'online' | 'degraded' | 'offline';
  batteryPct?: number;
  temperatureC?: number;
}

export interface AndroidEligibility {
  eligible: boolean;
  reason?: 'NOT_ANDROID' | 'OFFLINE' | 'STALE' | 'CAPABILITY_MISSING';
  missingCapabilities: string[];
}

const DEFAULT_STALE_MS = 45_000;

export function toAndroidWorkerNode(input: AndroidResourceRegistration): WorkerNodeRecord {
  if (!input.nodeId.trim()) throw new Error('nodeId is required');
  if (!input.deviceId.trim()) throw new Error('deviceId is required');
  if (!input.platform.trim()) throw new Error('platform is required');
  if (!input.agentVersion.trim()) throw new Error('agentVersion is required');
  const heartbeatMs = Date.parse(input.lastHeartbeatAt);
  if (!Number.isFinite(heartbeatMs)) throw new Error('lastHeartbeatAt must be an ISO timestamp');
  if (typeof input.batteryPct === 'number' && (input.batteryPct < 0 || input.batteryPct > 100)) {
    throw new Error('batteryPct must be between 0 and 100');
  }
  return {
    nodeId: input.nodeId,
    kind: 'android',
    platform: input.platform,
    agentVersion: input.agentVersion,
    capabilities: [...new Set(input.capabilities.filter(Boolean))],
    status: input.status ?? 'online',
    lastHeartbeatAt: input.lastHeartbeatAt,
    deviceRef: input.deviceId,
    batteryPct: input.batteryPct,
    temperatureC: input.temperatureC,
  };
}

export function androidResourceEligibility(
  node: WorkerNodeRecord,
  task: TaskPacket,
  nowMs = Date.now(),
  staleMs = DEFAULT_STALE_MS,
): AndroidEligibility {
  if (node.kind !== 'android') return { eligible: false, reason: 'NOT_ANDROID', missingCapabilities: [] };
  if (node.status === 'offline') return { eligible: false, reason: 'OFFLINE', missingCapabilities: [] };
  const heartbeatMs = Date.parse(node.lastHeartbeatAt);
  if (!Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > staleMs) {
    return { eligible: false, reason: 'STALE', missingCapabilities: [] };
  }
  const available = new Set(node.capabilities);
  const missingCapabilities = task.requiredCapabilities.filter((capability) => !available.has(capability));
  if (missingCapabilities.length) return { eligible: false, reason: 'CAPABILITY_MISSING', missingCapabilities };
  return { eligible: true, missingCapabilities: [] };
}
