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
