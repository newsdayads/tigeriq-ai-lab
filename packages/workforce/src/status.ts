import type { EmployeeAvailability, TaskStage, WorkerKind, NodeStatus } from './index.js';
import { TaskQueue, WorkforceRegistry } from './index.js';

export interface WorkforceStatusSnapshot {
  generatedAt: string;
  nodes: {
    total: number;
    byStatus: Record<NodeStatus, number>;
    byKind: Record<WorkerKind, number>;
  };
  employees: {
    total: number;
    byAvailability: Record<EmployeeAvailability, number>;
    activeTasks: number;
    concurrencyCapacity: number;
    utilization: number;
    departments: Record<string, number>;
    providers: Record<string, number>;
  };
  tasks: {
    total: number;
    byStage: Record<TaskStage, number>;
    active: number;
    terminal: number;
    failed: number;
  };
  roster: Array<{
    employeeId: string;
    displayName: string;
    department: string;
    role: string;
    nodeId: string;
    provider: string | null;
    model: string | null;
    availability: EmployeeAvailability;
    healthScore: number;
    concurrencyLimit: number;
    activeTaskCount: number;
    currentTaskIds: string[];
  }>;
  taskList: Array<{
    taskId: string;
    objective: string;
    stage: TaskStage;
    priority: string;
    assignedEmployeeId: string | null;
  }>;
}

const NODE_STATUSES: NodeStatus[] = ['online', 'degraded', 'offline'];
const WORKER_KINDS: WorkerKind[] = ['android', 'api', 'local', 'browser', 'tool', 'simulator'];
const AVAILABILITIES: EmployeeAvailability[] = ['idle', 'busy', 'offline', 'degraded'];
const TASK_STAGES: TaskStage[] = ['queued', 'assigned', 'running', 'completed', 'failed', 'cancelled'];

function zeroRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

export function buildWorkforceStatus(
  registry: WorkforceRegistry,
  queue: TaskQueue,
  now: () => Date = () => new Date(),
): WorkforceStatusSnapshot {
  const nodes = registry.listNodes();
  const employees = registry.listEmployees();
  const tasks = queue.list();

  const byNodeStatus = zeroRecord(NODE_STATUSES);
  const byKind = zeroRecord(WORKER_KINDS);
  for (const node of nodes) {
    byNodeStatus[node.status] += 1;
    byKind[node.kind] += 1;
  }

  const byAvailability = zeroRecord(AVAILABILITIES);
  const departments: Record<string, number> = {};
  const providers: Record<string, number> = {};
  let activeTasks = 0;
  let concurrencyCapacity = 0;
  for (const employee of employees) {
    byAvailability[employee.availability] += 1;
    activeTasks += employee.activeTaskCount;
    concurrencyCapacity += employee.concurrencyLimit;
    departments[employee.department] = (departments[employee.department] ?? 0) + 1;
    const provider = employee.provider?.trim().toLowerCase() || 'unassigned';
    providers[provider] = (providers[provider] ?? 0) + 1;
  }

  const byStage = zeroRecord(TASK_STAGES);
  for (const record of tasks) byStage[record.stage] += 1;
  const active = byStage.queued + byStage.assigned + byStage.running;
  const terminal = byStage.completed + byStage.failed + byStage.cancelled;

  return {
    generatedAt: now().toISOString(),
    nodes: {
      total: nodes.length,
      byStatus: byNodeStatus,
      byKind,
    },
    employees: {
      total: employees.length,
      byAvailability,
      activeTasks,
      concurrencyCapacity,
      utilization: concurrencyCapacity > 0 ? activeTasks / concurrencyCapacity : 0,
      departments,
      providers,
    },
    tasks: {
      total: tasks.length,
      byStage,
      active,
      terminal,
      failed: byStage.failed,
    },
    roster: employees.map((employee) => ({
      employeeId: employee.employeeId,
      displayName: employee.displayName,
      department: employee.department,
      role: employee.role,
      nodeId: employee.nodeId,
      provider: employee.provider ?? null,
      model: employee.model ?? null,
      availability: employee.availability,
      healthScore: employee.healthScore,
      concurrencyLimit: employee.concurrencyLimit,
      activeTaskCount: employee.activeTaskCount,
      currentTaskIds: [...employee.currentTaskIds],
    })),
    taskList: tasks.map((record) => ({
      taskId: record.task.taskId,
      objective: record.task.objective,
      stage: record.stage,
      priority: record.task.priority,
      assignedEmployeeId: record.assignedEmployeeId ?? null,
    })),
  };
}
