export type WorkerKind = 'android' | 'api' | 'local' | 'browser' | 'tool' | 'simulator';
export type NodeStatus = 'online' | 'degraded' | 'offline';
export type EmployeeAvailability = 'idle' | 'busy' | 'offline' | 'degraded';
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskStage = 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ResultStatus = 'completed' | 'failed';
export type Verdict = 'pass' | 'fail' | 'needs-work';

export interface OrganizationUnit {
  id: string;
  name: string;
  type: 'company' | 'department' | 'team';
  parentId?: string;
  managerAgentId?: string;
}

export interface WorkerNodeRecord {
  nodeId: string;
  kind: WorkerKind;
  platform: string;
  agentVersion: string;
  capabilities: string[];
  status: NodeStatus;
  lastHeartbeatAt: string;
  deviceRef?: string;
  batteryPct?: number;
  temperatureC?: number;
}

export interface EmployeeRecord {
  employeeId: string;
  displayName: string;
  department: string;
  team?: string;
  role: string;
  nodeId: string;
  provider?: string;
  model?: string;
  capabilities: string[];
  availability: EmployeeAvailability;
  healthScore: number;
  concurrencyLimit: number;
  activeTaskCount: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
  currentTaskIds: string[];
}

export interface TaskInput {
  name: string;
  value: unknown;
}

export interface ReviewPolicy {
  independentReview: boolean;
  judgeRequired: boolean;
  preferProviderDiversity: boolean;
}

export interface TaskPacket {
  taskId: string;
  idempotencyKey: string;
  objective: string;
  department?: string;
  team?: string;
  priority: TaskPriority;
  requiredCapabilities: string[];
  constraints: string[];
  inputs: TaskInput[];
  expectedArtifacts: string[];
  deadline: string;
  maxAttempts: number;
  reviewPolicy: ReviewPolicy;
}

export interface EvidenceArtifact {
  kind: 'text' | 'json' | 'screenshot' | 'log' | 'commit' | 'url';
  ref: string;
  summary?: string;
  sha256?: string;
}

export interface WorkerResult {
  taskId: string;
  employeeId: string;
  status: ResultStatus;
  conclusion: string;
  confidence: number;
  verdict?: Verdict;
  artifacts: EvidenceArtifact[];
  risks: string[];
  completedAt: string;
  failure?: {
    code: string;
    message: string;
    retriable: boolean;
  };
}

export interface TaskRuntimeRecord {
  task: TaskPacket;
  stage: TaskStage;
  attempts: number;
  assignedEmployeeId?: string;
  lastErrorCode?: string;
  result?: WorkerResult;
}

export interface WorkerAdapter {
  readonly kind: WorkerKind;
  execute(task: TaskPacket, employee: EmployeeRecord): Promise<WorkerResult>;
}

export interface ScheduleOptions {
  excludeEmployeeIds?: string[];
  excludeProviders?: string[];
}

export interface BatchAssuranceResult {
  primary: WorkerResult[];
  review?: WorkerResult;
  judgment?: WorkerResult;
  passed: boolean;
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function cloneNode(node: WorkerNodeRecord): WorkerNodeRecord {
  return { ...node, capabilities: [...node.capabilities] };
}

function cloneEmployee(employee: EmployeeRecord): EmployeeRecord {
  return {
    ...employee,
    capabilities: [...employee.capabilities],
    currentTaskIds: [...employee.currentTaskIds],
  };
}

export class OrganizationChart {
  readonly #units = new Map<string, OrganizationUnit>();

  add(unit: OrganizationUnit): void {
    assertNonEmpty(unit.id, 'organization unit id');
    assertNonEmpty(unit.name, 'organization unit name');
    if (this.#units.has(unit.id)) throw new Error(`organization unit ${unit.id} already exists`);
    if (unit.parentId && !this.#units.has(unit.parentId)) {
      throw new Error(`parent organization unit ${unit.parentId} not found`);
    }
    this.#units.set(unit.id, { ...unit });
  }

  get(id: string): OrganizationUnit | undefined {
    const unit = this.#units.get(id);
    return unit ? { ...unit } : undefined;
  }

  list(): OrganizationUnit[] {
    return [...this.#units.values()].map((unit) => ({ ...unit }));
  }

  ancestry(id: string): OrganizationUnit[] {
    const result: OrganizationUnit[] = [];
    let current = this.#units.get(id);
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current.id)) throw new Error('organization hierarchy cycle detected');
      seen.add(current.id);
      result.push({ ...current });
      current = current.parentId ? this.#units.get(current.parentId) : undefined;
    }
    return result;
  }
}

export class WorkforceRegistry {
  readonly #nodes = new Map<string, WorkerNodeRecord>();
  readonly #employees = new Map<string, EmployeeRecord>();

  registerNode(node: WorkerNodeRecord): void {
    assertNonEmpty(node.nodeId, 'nodeId');
    if (this.#nodes.has(node.nodeId)) throw new Error(`node ${node.nodeId} already exists`);
    this.#nodes.set(node.nodeId, cloneNode(node));
  }

  heartbeat(nodeId: string, update: Partial<Pick<WorkerNodeRecord, 'status' | 'lastHeartbeatAt' | 'batteryPct' | 'temperatureC' | 'agentVersion'>>): WorkerNodeRecord {
    const node = this.#nodes.get(nodeId);
    if (!node) throw new Error(`node ${nodeId} not found`);
    const next = { ...node, ...update };
    if (typeof next.batteryPct === 'number' && (next.batteryPct < 0 || next.batteryPct > 100)) {
      throw new Error('batteryPct must be between 0 and 100');
    }
    this.#nodes.set(nodeId, next);
    for (const employee of this.#employees.values()) {
      if (employee.nodeId !== nodeId) continue;
      if (next.status === 'offline') employee.availability = 'offline';
      else if (next.status === 'degraded' && employee.activeTaskCount === 0) employee.availability = 'degraded';
      else if (employee.activeTaskCount === 0) employee.availability = 'idle';
    }
    return cloneNode(next);
  }

  getNode(nodeId: string): WorkerNodeRecord | undefined {
    const node = this.#nodes.get(nodeId);
    return node ? cloneNode(node) : undefined;
  }

  listNodes(): WorkerNodeRecord[] {
    return [...this.#nodes.values()].map(cloneNode);
  }

  registerEmployee(input: Omit<EmployeeRecord, 'activeTaskCount' | 'completedTasks' | 'failedTasks' | 'successRate' | 'currentTaskIds'> & Partial<Pick<EmployeeRecord, 'activeTaskCount' | 'completedTasks' | 'failedTasks' | 'successRate' | 'currentTaskIds'>>): void {
    assertNonEmpty(input.employeeId, 'employeeId');
    if (this.#employees.has(input.employeeId)) throw new Error(`employee ${input.employeeId} already exists`);
    if (!this.#nodes.has(input.nodeId)) throw new Error(`employee node ${input.nodeId} not found`);
    if (input.concurrencyLimit < 1) throw new Error('concurrencyLimit must be >= 1');
    const completedTasks = input.completedTasks ?? 0;
    const failedTasks = input.failedTasks ?? 0;
    const outcomes = completedTasks + failedTasks;
    this.#employees.set(input.employeeId, {
      ...input,
      capabilities: [...input.capabilities],
      healthScore: clampScore(input.healthScore),
      activeTaskCount: input.activeTaskCount ?? 0,
      completedTasks,
      failedTasks,
      successRate: outcomes > 0 ? completedTasks / outcomes : (input.successRate ?? 1),
      currentTaskIds: [...(input.currentTaskIds ?? [])],
    });
  }

  getEmployee(employeeId: string): EmployeeRecord | undefined {
    const employee = this.#employees.get(employeeId);
    return employee ? cloneEmployee(employee) : undefined;
  }

  listEmployees(): EmployeeRecord[] {
    return [...this.#employees.values()].map(cloneEmployee);
  }

  acquire(employeeId: string, taskId: string): EmployeeRecord {
    const employee = this.#employees.get(employeeId);
    if (!employee) throw new Error(`employee ${employeeId} not found`);
    const node = this.#nodes.get(employee.nodeId);
    if (!node || node.status === 'offline') throw new Error(`employee ${employeeId} node is offline`);
    if (employee.activeTaskCount >= employee.concurrencyLimit) throw new Error(`employee ${employeeId} is at concurrency limit`);
    if (!employee.currentTaskIds.includes(taskId)) employee.currentTaskIds.push(taskId);
    employee.activeTaskCount += 1;
    employee.availability = employee.activeTaskCount >= employee.concurrencyLimit ? 'busy' : 'idle';
    return cloneEmployee(employee);
  }

  release(employeeId: string, taskId: string, success: boolean): EmployeeRecord {
    const employee = this.#employees.get(employeeId);
    if (!employee) throw new Error(`employee ${employeeId} not found`);
    employee.currentTaskIds = employee.currentTaskIds.filter((id) => id !== taskId);
    employee.activeTaskCount = Math.max(0, employee.activeTaskCount - 1);
    if (success) employee.completedTasks += 1;
    else employee.failedTasks += 1;
    const outcomes = employee.completedTasks + employee.failedTasks;
    employee.successRate = outcomes > 0 ? employee.completedTasks / outcomes : 1;
    const node = this.#nodes.get(employee.nodeId);
    employee.availability = node?.status === 'offline' ? 'offline' : node?.status === 'degraded' ? 'degraded' : employee.activeTaskCount >= employee.concurrencyLimit ? 'busy' : 'idle';
    return cloneEmployee(employee);
  }
}

export class TaskQueue {
  readonly #records = new Map<string, TaskRuntimeRecord>();
  readonly #idempotency = new Map<string, string>();

  enqueue(task: TaskPacket): TaskRuntimeRecord {
    validateTaskPacket(task);
    const existingId = this.#idempotency.get(task.idempotencyKey);
    if (existingId) return this.get(existingId);
    if (this.#records.has(task.taskId)) throw new Error(`task ${task.taskId} already exists`);
    const record: TaskRuntimeRecord = { task: cloneTask(task), stage: 'queued', attempts: 0 };
    this.#records.set(task.taskId, record);
    this.#idempotency.set(task.idempotencyKey, task.taskId);
    return cloneRuntime(record);
  }

  get(taskId: string): TaskRuntimeRecord {
    const record = this.#records.get(taskId);
    if (!record) throw new Error(`task ${taskId} not found`);
    return cloneRuntime(record);
  }

  assign(taskId: string, employeeId: string): TaskRuntimeRecord {
    const record = this.#mustGetMutable(taskId);
    if (!['queued', 'failed'].includes(record.stage)) throw new Error(`task ${taskId} cannot be assigned from ${record.stage}`);
    if (record.attempts >= record.task.maxAttempts) throw new Error(`task ${taskId} exhausted maxAttempts`);
    record.stage = 'assigned';
    record.assignedEmployeeId = employeeId;
    record.attempts += 1;
    return cloneRuntime(record);
  }

  start(taskId: string): TaskRuntimeRecord {
    const record = this.#mustGetMutable(taskId);
    if (record.stage !== 'assigned') throw new Error(`task ${taskId} cannot start from ${record.stage}`);
    record.stage = 'running';
    return cloneRuntime(record);
  }

  complete(taskId: string, result: WorkerResult): TaskRuntimeRecord {
    const record = this.#mustGetMutable(taskId);
    if (record.stage !== 'running') throw new Error(`task ${taskId} cannot complete from ${record.stage}`);
    record.stage = 'completed';
    record.result = cloneResult(result);
    record.lastErrorCode = undefined;
    return cloneRuntime(record);
  }

  fail(taskId: string, result: WorkerResult): TaskRuntimeRecord {
    const record = this.#mustGetMutable(taskId);
    if (record.stage !== 'running') throw new Error(`task ${taskId} cannot fail from ${record.stage}`);
    record.stage = 'failed';
    record.result = cloneResult(result);
    record.lastErrorCode = result.failure?.code;
    return cloneRuntime(record);
  }

  requeue(taskId: string): TaskRuntimeRecord {
    const record = this.#mustGetMutable(taskId);
    if (record.stage !== 'failed') throw new Error(`task ${taskId} cannot requeue from ${record.stage}`);
    if (record.attempts >= record.task.maxAttempts) return cloneRuntime(record);
    record.stage = 'queued';
    record.assignedEmployeeId = undefined;
    return cloneRuntime(record);
  }

  list(): TaskRuntimeRecord[] {
    return [...this.#records.values()].map(cloneRuntime);
  }

  #mustGetMutable(taskId: string): TaskRuntimeRecord {
    const record = this.#records.get(taskId);
    if (!record) throw new Error(`task ${taskId} not found`);
    return record;
  }
}

export class CapabilityScheduler {
  constructor(private readonly registry: WorkforceRegistry) {}

  rank(task: TaskPacket, options: ScheduleOptions = {}): Array<{ employee: EmployeeRecord; score: number }> {
    const excludedEmployees = new Set(options.excludeEmployeeIds ?? []);
    const excludedProviders = new Set((options.excludeProviders ?? []).map((provider) => provider.toLowerCase()));
    return this.registry.listEmployees()
      .filter((employee) => !excludedEmployees.has(employee.employeeId))
      .filter((employee) => employee.availability !== 'offline' && employee.availability !== 'degraded')
      .filter((employee) => employee.activeTaskCount < employee.concurrencyLimit)
      .filter((employee) => task.requiredCapabilities.every((capability) => employee.capabilities.includes(capability)))
      .filter((employee) => !employee.provider || !excludedProviders.has(employee.provider.toLowerCase()))
      .map((employee) => {
        let score = employee.healthScore * 0.35 + employee.successRate * 40;
        score += task.requiredCapabilities.length * 8;
        if (task.department && employee.department === task.department) score += 15;
        if (task.team && employee.team === task.team) score += 8;
        score -= (employee.activeTaskCount / employee.concurrencyLimit) * 25;
        return { employee, score };
      })
      .sort((a, b) => b.score - a.score || a.employee.employeeId.localeCompare(b.employee.employeeId));
  }

  select(task: TaskPacket, options: ScheduleOptions = {}): EmployeeRecord | undefined {
    return this.rank(task, options)[0]?.employee;
  }
}

export class WorkforceOrchestrator {
  readonly #adapters = new Map<WorkerKind, WorkerAdapter>();

  constructor(
    readonly registry: WorkforceRegistry,
    readonly queue: TaskQueue,
    readonly scheduler: CapabilityScheduler,
  ) {}

  registerAdapter(adapter: WorkerAdapter): void {
    this.#adapters.set(adapter.kind, adapter);
  }

  async execute(task: TaskPacket, options: ScheduleOptions = {}): Promise<WorkerResult> {
    const existing = this.queue.enqueue(task);
    if (existing.stage === 'completed' && existing.result) return existing.result;
    const failedEmployees = new Set(options.excludeEmployeeIds ?? []);
    let finalResult: WorkerResult | undefined;

    while (this.queue.get(task.taskId).attempts < task.maxAttempts) {
      const employee = this.scheduler.select(task, {
        ...options,
        excludeEmployeeIds: [...failedEmployees],
      });
      if (!employee) throw new Error(`no eligible employee for task ${task.taskId}`);
      const node = this.registry.getNode(employee.nodeId);
      if (!node) throw new Error(`node ${employee.nodeId} not found`);
      const adapter = this.#adapters.get(node.kind);
      if (!adapter) throw new Error(`no adapter registered for worker kind ${node.kind}`);

      this.queue.assign(task.taskId, employee.employeeId);
      this.registry.acquire(employee.employeeId, task.taskId);
      this.queue.start(task.taskId);

      try {
        const result = validateResult(await adapter.execute(task, employee), task, employee);
        finalResult = result;
        if (result.status === 'completed') {
          this.queue.complete(task.taskId, result);
          this.registry.release(employee.employeeId, task.taskId, true);
          return result;
        }
        this.queue.fail(task.taskId, result);
        this.registry.release(employee.employeeId, task.taskId, false);
        failedEmployees.add(employee.employeeId);
        if (!result.failure?.retriable) return result;
        this.queue.requeue(task.taskId);
      } catch (error) {
        const result = failureResult(task.taskId, employee.employeeId, error);
        finalResult = result;
        this.queue.fail(task.taskId, result);
        this.registry.release(employee.employeeId, task.taskId, false);
        failedEmployees.add(employee.employeeId);
        this.queue.requeue(task.taskId);
      }
    }

    if (finalResult) return finalResult;
    throw new Error(`task ${task.taskId} exhausted without a result`);
  }

  async executeBatchWithAssurance(
    tasks: TaskPacket[],
    makeReviewTask: (primary: WorkerResult[]) => TaskPacket,
    makeJudgeTask?: (primary: WorkerResult[], review: WorkerResult) => TaskPacket,
  ): Promise<BatchAssuranceResult> {
    if (tasks.length === 0) throw new Error('batch requires at least one primary task');
    const primary = await Promise.all(tasks.map((task) => this.execute(task)));
    if (primary.some((result) => result.status !== 'completed')) return { primary, passed: false };

    const primaryEmployees = primary.map((result) => result.employeeId);
    const primaryProviders = primary
      .map((result) => this.registry.getEmployee(result.employeeId)?.provider)
      .filter((provider): provider is string => Boolean(provider));
    const reviewTask = makeReviewTask(primary);
    const review = await this.execute(reviewTask, {
      excludeEmployeeIds: primaryEmployees,
      excludeProviders: reviewTask.reviewPolicy.preferProviderDiversity ? primaryProviders : [],
    });
    if (review.status !== 'completed' || review.verdict !== 'pass') return { primary, review, passed: false };

    if (!reviewTask.reviewPolicy.judgeRequired || !makeJudgeTask) return { primary, review, passed: true };
    const judgeTask = makeJudgeTask(primary, review);
    const reviewer = this.registry.getEmployee(review.employeeId);
    const excludeProviders = judgeTask.reviewPolicy.preferProviderDiversity
      ? [...primaryProviders, ...(reviewer?.provider ? [reviewer.provider] : [])]
      : [];
    const judgment = await this.execute(judgeTask, {
      excludeEmployeeIds: [...primaryEmployees, review.employeeId],
      excludeProviders,
    });
    return {
      primary,
      review,
      judgment,
      passed: judgment.status === 'completed' && judgment.verdict === 'pass',
    };
  }
}

export function validateTaskPacket(task: TaskPacket): void {
  assertNonEmpty(task.taskId, 'taskId');
  assertNonEmpty(task.idempotencyKey, 'idempotencyKey');
  assertNonEmpty(task.objective, 'objective');
  if (task.maxAttempts < 1 || task.maxAttempts > 10) throw new Error('maxAttempts must be between 1 and 10');
  if (!Number.isFinite(Date.parse(task.deadline))) throw new Error('deadline must be an ISO date');
  if (task.expectedArtifacts.length === 0) throw new Error('expectedArtifacts are required');
}

function validateResult(result: WorkerResult, task: TaskPacket, employee: EmployeeRecord): WorkerResult {
  if (result.taskId !== task.taskId) throw new Error('worker result taskId mismatch');
  if (result.employeeId !== employee.employeeId) throw new Error('worker result employeeId mismatch');
  if (result.confidence < 0 || result.confidence > 1) throw new Error('worker result confidence must be between 0 and 1');
  return cloneResult(result);
}

function failureResult(taskId: string, employeeId: string, error: unknown): WorkerResult {
  return {
    taskId,
    employeeId,
    status: 'failed',
    conclusion: 'Worker adapter failed before a valid structured result was returned.',
    confidence: 0,
    artifacts: [],
    risks: ['worker-adapter-error'],
    completedAt: new Date().toISOString(),
    failure: {
      code: 'WORKER_ADAPTER_ERROR',
      message: error instanceof Error ? error.message : String(error),
      retriable: true,
    },
  };
}

function cloneTask(task: TaskPacket): TaskPacket {
  return {
    ...task,
    requiredCapabilities: [...task.requiredCapabilities],
    constraints: [...task.constraints],
    inputs: task.inputs.map((input) => ({ ...input })),
    expectedArtifacts: [...task.expectedArtifacts],
    reviewPolicy: { ...task.reviewPolicy },
  };
}

function cloneResult(result: WorkerResult): WorkerResult {
  return {
    ...result,
    artifacts: result.artifacts.map((artifact) => ({ ...artifact })),
    risks: [...result.risks],
    failure: result.failure ? { ...result.failure } : undefined,
  };
}

function cloneRuntime(record: TaskRuntimeRecord): TaskRuntimeRecord {
  return {
    ...record,
    task: cloneTask(record.task),
    result: record.result ? cloneResult(record.result) : undefined,
  };
}
