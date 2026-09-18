import { fetchBacklogIssues, type BacklogIssue } from '../../../apps/tigeriq-core/github-intake.mjs';
import { createWorkOrder } from '../../../apps/tigeriq-core/index.mjs'; // Or core coding lane entry point
import type { DurableControlPlane } from '../../../packages/durable-control-plane/src/index.js';

export type Priority = 'OWNER_DIRECT' | 'P0' | 'P1' | 'P2' | 'P3';

const priorityOrder: Record<Priority, number> = {
  OWNER_DIRECT: 0,
  P0: 1,
  P1: 2,
  P2: 3,
  P3: 4,
};

export interface DispatchDecision {
  sourceIssueId: string;
  reason: string;
  chain: string;
  ownershipScope: string;
  timestamp: string;
  workOrderId?: string;
}

export class AutoBacklogDispatcher {
  private lastDecision: DispatchDecision | null = null;

  constructor(private durableStore: DurableControlPlane) {}

  async dispatchNext(scope: string, actor: any): Promise<DispatchDecision | null> {
    // 1. Fetch current executable backlog
    const issues = (await fetchBacklogIssues()) as BacklogIssue[];

    // 2. Prioritize issues by OWNER_DIRECT > P0 > P1 > P2 > P3
    const sorted = issues.sort((a, b) => {
      const pA = (a.priority || 'P3') as Priority;
      const pB = (b.priority || 'P3') as Priority;
      return (priorityOrder[pA] ?? 4) - (priorityOrder[pB] ?? 4);
    });

    // 3 & 4. Deduplicate & Enforce single active mutation per owner/scope
    for (const issue of sorted) {
      const issueId = String(issue.id);
      const dispatchKey = `dispatch:${scope}:${issueId}`;
      const scopeKey = `scope-active:${scope}`;

      // Check durable store for idempotency / active status
      const existingState = await this.durableStore.getMetadata?.(dispatchKey);
      if (existingState) {
        continue; // Already dispatched / processed
      }

      const activeScopeWork = await this.durableStore.getMetadata?.(scopeKey);
      if (activeScopeWork) {
        continue; // Active mutation exists for this scope
      }

      // 5. Persist dispatch decisions in the durable control plane
      const decision: DispatchDecision = {
        sourceIssueId: issueId,
        reason: `Selected by priority ${issue.priority || 'P3'}`,
        chain: issue.chain || 'default-chain',
        ownershipScope: scope,
        timestamp: new Date().toISOString(),
      };

      await this.durableStore.setMetadata?.(dispatchKey, JSON.stringify(decision));
      await this.durableStore.setMetadata?.(scopeKey, issueId);

      // 6. Invoke Core/Coding-Lane entry point
      try {
        const workOrder = await createWorkOrder({
          goal: issue.title,
          scope: [scope],
          invariants: [],
          acceptanceCriteria: issue.acceptanceCriteria || [],
          status: 'approved',
        }, actor);
        decision.workOrderId = workOrder.id;
      } catch (err) {
        // Fallback or handle invocation error if needed
      }

      this.lastDecision = decision;
      return decision;
    }

    return null;
  }

  getLastDecision(): DispatchDecision | null {
    return this.lastDecision;
  }
}
