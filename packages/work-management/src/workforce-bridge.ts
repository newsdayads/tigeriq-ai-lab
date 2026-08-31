import type { EmployeeRecord, WorkerNodeRecord, WorkforceRegistry } from '../../workforce/src/index.js';
import type { AutonomousWorkManager } from './manager.js';
import type { ManagedWorker, WorkDriver, WorkRole, WorkerKind } from './types.js';

export interface WorkforceRegistryBridgeOptions {
  driverForEmployee(employee: EmployeeRecord, node: WorkerNodeRecord): WorkDriver;
  rolesForEmployee(employee: EmployeeRecord, node: WorkerNodeRecord): WorkRole[];
  kindForNode?(node: WorkerNodeRecord): WorkerKind;
  allowedScopesForEmployee?(employee: EmployeeRecord, node: WorkerNodeRecord): string[] | undefined;
}

/**
 * Read-only integration boundary from the authoritative Workforce Registry into
 * WO-044 work management. It mirrors identity/capability/health/concurrency only;
 * execution remains delegated through a supplied WorkDriver so this package does
 * not modify AI Coordinator routing or PC01 runtime behavior.
 */
export class WorkforceRegistryBridge {
  constructor(
    private readonly registry: WorkforceRegistry,
    private readonly manager: AutonomousWorkManager,
    private readonly options: WorkforceRegistryBridgeOptions,
  ) {}

  sync(): string[] {
    const registered: string[] = [];
    for (const employee of this.registry.listEmployees()) {
      const node = this.registry.getNode(employee.nodeId);
      if (!node) continue;
      const roles = this.options.rolesForEmployee(employee, node);
      if (roles.length === 0) continue;
      const remainingConcurrency = Math.max(0, employee.concurrencyLimit - employee.activeTaskCount);
      const worker: ManagedWorker = {
        workerId: employee.employeeId,
        kind: this.options.kindForNode?.(node) ?? defaultManagedWorkerKind(node),
        roles: [...roles],
        capabilities: [...employee.capabilities],
        concurrencyLimit: Math.max(1, remainingConcurrency),
        allowedScopes: this.options.allowedScopesForEmployee?.(employee, node),
        independenceKey: independenceKeyFor(employee, node),
        online:
          node.status === 'online' &&
          employee.availability !== 'offline' &&
          employee.availability !== 'degraded' &&
          remainingConcurrency > 0,
      };
      this.manager.registerWorker(worker, this.options.driverForEmployee(employee, node));
      registered.push(worker.workerId);
    }
    return registered;
  }
}

function independenceKeyFor(employee: EmployeeRecord, node: WorkerNodeRecord): string {
  const provider = employee.provider?.trim().toLowerCase();
  const model = employee.model?.trim().toLowerCase();
  // Same provider/model is the same assurance identity even when reached through
  // different runtime nodes; aliases must not spoof independent review.
  if (provider && model) return `${provider}:${model}`;
  if (provider) return `${provider}:unknown-model`;
  if (model) return `unknown-provider:${model}`;
  // Unknown cloud/browser AI identity cannot safely be treated as independent.
  if (node.kind === 'api' || node.kind === 'browser' || node.kind === 'simulator') return 'unidentified-ai';
  // Physical/local/tool runtimes have a concrete node identity when no model
  // identity exists. Workers sharing that node remain the same assurance identity.
  return `${node.kind}:${node.nodeId}`.toLowerCase();
}

export function defaultManagedWorkerKind(node: WorkerNodeRecord): WorkerKind {
  switch (node.kind) {
    case 'android':
      return 'device';
    case 'local':
      return 'pc01';
    case 'tool':
      return 'tool';
    case 'api':
    case 'browser':
    case 'simulator':
      return 'ai';
  }
}
