import { createHash } from 'node:crypto';
import type { EmployeeRecord, TaskPacket, TaskRuntimeRecord } from './index.js';
import type { DurableAutonomyStore, BlockedWorkRecord } from './autonomy-store.js';
import type { DurableWorkforceRuntime } from './runtime.js';
import type { NearEmptyAuditContext, NearEmptyAuditProposal, NearEmptyAuditProvider } from './remote-task-broker.js';

const GENERATED_MARKER = 'autonomy:self-audit-generated=true';

/**
 * Zero-cost, fail-closed near-empty inspection for concrete runtime-state anomalies.
 *
 * This provider never mutates the source work item. It only proposes bounded Level-A
 * repair/audit tasks when the current journal/queue state itself contains machine-verifiable
 * evidence of drift. When there is no evidence, it returns no work instead of inventing work.
 */
export class RuntimeStateNearEmptyAuditProvider implements NearEmptyAuditProvider {
  constructor(
    private readonly runtime: DurableWorkforceRuntime,
    private readonly autonomy?: DurableAutonomyStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async inspect(context: NearEmptyAuditContext): Promise<NearEmptyAuditProposal[]> {
    const records = this.runtime.queue.list();
    const byId = new Map(records.map((record) => [record.task.taskId, record]));
    const waits = this.autonomy ? await this.autonomy.listForNode(context.nodeId) : [];
    const proposals: NearEmptyAuditProposal[] = [];

    for (const wait of waits) {
      const record = byId.get(wait.workId);
      if (!record) {
        const employee = this.#employeeForNode(context.nodeId, wait.employeeId);
        if (employee) proposals.push(this.#staleWaitProposal(wait, employee, 'queue record is missing'));
        continue;
      }
      if (record.stage !== 'failed') {
        const employee = this.#employeeForNode(context.nodeId, wait.employeeId);
        if (employee) proposals.push(this.#staleWaitProposal(wait, employee, `queue stage is ${record.stage}, expected failed`));
      }
    }

    const waitingIds = new Set(waits.map((wait) => wait.workId));
    for (const record of records) {
      if (record.task.constraints.includes(GENERATED_MARKER)) continue;
      if (record.stage !== 'failed') continue;
      if (!record.result?.failure?.retriable) continue;
      if (record.attempts >= record.task.maxAttempts) continue;
      if (waitingIds.has(record.task.taskId)) continue;
      const employee = record.assignedEmployeeId
        ? this.runtime.registry.getEmployee(record.assignedEmployeeId)
        : undefined;
      if (!employee || employee.nodeId !== context.nodeId) continue;
      proposals.push(this.#staleRetryProposal(record, employee));
    }

    return proposals;
  }

  #employeeForNode(nodeId: string, preferredEmployeeId?: string): EmployeeRecord | undefined {
    if (preferredEmployeeId) {
      const preferred = this.runtime.registry.getEmployee(preferredEmployeeId);
      if (preferred?.nodeId === nodeId && preferred.availability !== 'offline' && preferred.availability !== 'degraded') return preferred;
    }
    return this.runtime.registry.listEmployees()
      .filter((employee) => employee.nodeId === nodeId)
      .filter((employee) => employee.availability !== 'offline' && employee.availability !== 'degraded')
      .sort((a, b) => b.healthScore - a.healthScore || a.employeeId.localeCompare(b.employeeId))[0];
  }

  #staleWaitProposal(wait: BlockedWorkRecord, employee: EmployeeRecord, detail: string): NearEmptyAuditProposal {
    const evidence = `runtime:autonomy:${wait.workId}:${detail}`;
    return this.#proposal({
      sourceId: wait.workId,
      code: 'STALE-WAIT',
      kind: 'bug',
      employee,
      evidence,
      objective: `Reconcile stale autonomy wait state for ${wait.workId}: ${detail}; preserve fail-closed routing and restore consistent queue/journal evidence.`,
      acceptanceCriteria: [
        `Autonomy wait ${wait.workId} matches an existing failed queue record or is safely cleared with evidence.`,
        'No source task is marked completed without a valid worker result.',
        'The repair remains repo/runtime-state scoped and does not widen credentials, network, Production, or MAIN authority.',
      ],
    });
  }

  #staleRetryProposal(record: TaskRuntimeRecord, employee: EmployeeRecord): NearEmptyAuditProposal {
    const failureCode = record.result?.failure?.code ?? 'UNKNOWN';
    const evidence = `runtime:queue:${record.task.taskId}:failed-retriable:${failureCode}:attempts=${record.attempts}/${record.task.maxAttempts}`;
    return this.#proposal({
      sourceId: record.task.taskId,
      code: 'STALE-RETRY',
      kind: 'self_heal',
      employee,
      evidence,
      objective: `Investigate and reconcile retriable failed work ${record.task.taskId} that still has retry budget but is neither queued nor waiting; restore bounded retry flow without claiming false completion.`,
      acceptanceCriteria: [
        `${record.task.taskId} is either safely requeued within its existing maxAttempts budget or explicitly converted to a supported waiting state with evidence.`,
        'No unbounded retry loop is introduced.',
        'The provider itself performs no mutation of the source work item.',
      ],
    });
  }

  #proposal(input: {
    sourceId: string;
    code: 'STALE-WAIT' | 'STALE-RETRY';
    kind: 'bug' | 'self_heal';
    employee: EmployeeRecord;
    evidence: string;
    objective: string;
    acceptanceCriteria: string[];
  }): NearEmptyAuditProposal {
    const suffix = stableId(input.sourceId);
    const taskId = `SELF-AUDIT-${input.code}-${suffix}`;
    const resourceScope = `workforce-autonomy-repair:${input.code.toLowerCase()}:${suffix}`;
    const deadline = new Date(this.now().getTime() + 4 * 60 * 60 * 1000).toISOString();
    const task: TaskPacket = {
      taskId,
      idempotencyKey: `near-empty:${input.code.toLowerCase()}:${input.sourceId}`,
      objective: input.objective,
      department: input.employee.department,
      team: input.employee.team,
      priority: input.kind === 'bug' ? 'P1' : 'P2',
      requiredCapabilities: [...input.employee.capabilities],
      constraints: [
        'autonomy:level=A',
        `autonomy:resource=${resourceScope}`,
        GENERATED_MARKER,
        'safety:repo-runtime-state-only',
        'safety:no-main-production-cost-credential-security-reboot',
      ],
      inputs: [{ name: 'machineEvidence', value: input.evidence }],
      expectedArtifacts: ['structured-result', 'runtime-state-evidence'],
      deadline,
      maxAttempts: 2,
      reviewPolicy: { independentReview: true, judgeRequired: false, preferProviderDiversity: true },
    };
    return {
      task,
      finding: {
        workId: taskId,
        objective: input.objective,
        kind: input.kind,
        level: 'A',
        resourceScope,
        evidenceRefs: [input.evidence],
        acceptanceCriteria: [...input.acceptanceCriteria],
        rollback: `Remove generated task ${taskId}; the provider does not mutate ${input.sourceId}.`,
      },
    };
  }
}

function stableId(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'WORK';
  const digest = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16).toUpperCase();
  return `${normalized.slice(0, 32)}-${digest}`;
}
