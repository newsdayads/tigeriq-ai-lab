import { getRuntimeTruth, updateRuntimeTruth } from './runtimeTruth.js';
import { scanCore, verifyFindings, dedupeFindings, dispatchFinding } from './auditHelpers.js';
import { createWorkItem } from './workOrderSystem.js';

export interface NVNode {
  id: string;
  status: 'READY' | 'IDLE' | 'ONLINE' | 'BUSY' | 'RUNNING' | 'REVIEWING' | 'RATE_LIMITED' | 'BLOCKED' | 'WAIT_KEY' | 'OFFLINE';
  lastIdleTimestamp: number;
  activeLoad: number;
}

export interface AuditorState {
  currentAuditorId: string | null;
  last_scan: number;
  last_deep_scan: number;
  openIncidents: any[];
}

let lightIntervalHandle: NodeJS.Timeout | null = null;
let deepIntervalHandle: NodeJS.Timeout | null = null;
let roundRobinIndex = 0;

export function filterEligibleNodes(nodes: NVNode[]): NVNode[] {
  const excludedStatuses = new Set(['BUSY', 'RUNNING', 'REVIEWING', 'RATE_LIMITED', 'BLOCKED', 'WAIT_KEY', 'OFFLINE']);
  return nodes.filter(node => !excludedStatuses.has(node.status));
}

export function selectAuditorNode(nodes: NVNode[]):
  | NVNode
  | null {
  const eligible = filterEligibleNodes(nodes);
  if (eligible.length === 0) return null;

  // Sort by activeLoad ascending, then by lastIdleTimestamp ascending (longest idle first)
  eligible.sort((a, b) => {
    if (a.activeLoad !== b.activeLoad) {
      return a.activeLoad - b.activeLoad;
    }
    if (a.lastIdleTimestamp !== b.lastIdleTimestamp) {
      return a.lastIdleTimestamp - b.lastIdleTimestamp;
    }
    return 0;
  });

  // Fallback to round-robin if loads and timestamps are identical
  const minLoad = eligible[0].activeLoad;
  const minTimestamp = eligible[0].lastIdleTimestamp;
  const tiedNodes = eligible.filter(
    n => n.activeLoad === minLoad && n.lastIdleTimestamp === minTimestamp
  );

  if (tiedNodes.length > 1) {
    const chosen = tiedNodes[roundRobinIndex % tiedNodes.length];
    roundRobinIndex = (roundRobinIndex + 1) % tiedNodes.length;
    return chosen;
  }

  return eligible[0];
}

export async function runAuditCycle(isDeep: boolean = false): Promise<void> {
  const truth = await getRuntimeTruth();
  const nodes: NVNode[] = truth.nodes || [];
  const selectedNode = selectAuditorNode(nodes);

  if (!selectedNode) {
    console.log('AUDIT_DEFERRED_NO_IDLE_RESOURCE');
    return;
  }

  const now = Date.now();
  const scanResults = await scanCore({ deep: isDeep, auditorId: selectedNode.id });
  const verified = await verifyFindings(scanResults);
  const deduped = await dedupeFindings(verified);

  for (const finding of deduped) {
    await dispatchFinding(finding);
    await createWorkItem({
      title: `Audit Finding: ${finding.id || 'Unknown'}`,
      description: finding.description || 'Discovered during audit cycle',
      source: 'auditorScheduler',
      assignedTo: null
    });
  }

  const currentTruth = await getRuntimeTruth();
  const state: AuditorState = currentTruth.auditorState || {
    currentAuditorId: null,
    last_scan: 0,
    last_deep_scan: 0,
    openIncidents: []
  };

  state.currentAuditorId = selectedNode.id;
  if (isDeep) {
    state.last_deep_scan = now;
  } else {
    state.last_scan = now;
  }
  state.openIncidents = deduped;

  await updateRuntimeTruth({ auditorState: state });
}

export function startAuditorScheduler(): void {
  if (lightIntervalHandle) clearInterval(lightIntervalHandle);
  if (deepIntervalHandle) clearInterval(deepIntervalHandle);

  lightIntervalHandle = setInterval(() => {
    runAuditCycle(false).catch(err => console.error('Light scan error:', err));
  }, 5 * 60 * 1000);

  deepIntervalHandle = setInterval(() => {
    runAuditCycle(true).catch(err => console.error('Deep scan error:', err));
  }, 30 * 60 * 1000);
}

export function stopAuditorScheduler(): void {
  if (lightIntervalHandle) {
    clearInterval(lightIntervalHandle);
    lightIntervalHandle = null;
  }
  if (deepIntervalHandle) {
    clearInterval(deepIntervalHandle);
    deepIntervalHandle = null;
  }
}
