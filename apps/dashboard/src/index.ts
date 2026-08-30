import type { WorkOrderSnapshot } from '../../../packages/control-plane/src/index.js';

export interface DashboardWorkOrder {
  id: string;
  project: string;
  goal: string;
  status: WorkOrderSnapshot['order']['status'];
  latestGate: string | null;
  latestGateStatus: 'pass' | 'fail' | 'blocked' | null;
  evidenceCount: number;
  failingEvidence: number;
}

export interface DashboardSummary {
  generatedAt: string;
  activeWorkOrders: number;
  blockedWorkOrders: number;
  failingGates: number;
  evidenceCount: number;
  releaseEligible: boolean;
  workOrders: DashboardWorkOrder[];
}

export function buildDashboard(snapshots: readonly WorkOrderSnapshot[], now = new Date()): DashboardSummary {
  const workOrders = snapshots.map((snapshot) => {
    const latestGate = snapshot.decisions.at(-1) ?? null;
    return {
      id: snapshot.order.id,
      project: snapshot.order.project,
      goal: snapshot.order.goal,
      status: snapshot.order.status,
      latestGate: latestGate?.gate ?? null,
      latestGateStatus: latestGate?.status ?? null,
      evidenceCount: snapshot.evidence.length,
      failingEvidence: snapshot.evidence.filter((item) => item.status !== 'pass' || item.exitCode !== 0).length,
    } satisfies DashboardWorkOrder;
  });
  const activeWorkOrders = workOrders.filter((item) => !['verified', 'blocked'].includes(item.status)).length;
  const blockedWorkOrders = workOrders.filter((item) => item.status === 'blocked').length;
  const failingGates = workOrders.filter((item) => item.latestGateStatus === 'fail' || item.latestGateStatus === 'blocked').length;
  const evidenceCount = workOrders.reduce((sum, item) => sum + item.evidenceCount, 0);
  const releaseEligible = workOrders.length > 0 && workOrders.every((item) => item.status === 'verified' && item.failingEvidence === 0);
  return { generatedAt: now.toISOString(), activeWorkOrders, blockedWorkOrders, failingGates, evidenceCount, releaseEligible, workOrders };
}

export function emptyDashboard(): DashboardSummary {
  return buildDashboard([], new Date(0));
}
