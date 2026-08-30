import {
  CapabilityScheduler,
  TaskQueue,
  WorkforceRegistry,
  type BatchAssuranceResult,
  type EmployeeRecord,
  type ScheduleOptions,
  type TaskPacket,
  type TaskRuntimeRecord,
  type WorkerAdapter,
  type WorkerKind,
  type WorkerNodeRecord,
  type WorkerResult,
} from './index.js';

export interface RuntimeScheduleOptions extends ScheduleOptions {
  preferredExcludeProviders?: string[];
}

export interface WorkforceSnapshot {
  version: 1;
  savedAt: string;
  nodes: WorkerNodeRecord[];
  employees: EmployeeRecord[];
  tasks: TaskRuntimeRecord[];
}

export interface WorkforceStateStore {
  load(): Promise<WorkforceSnapshot | undefined>;
  save(snapshot: WorkforceSnapshot): Promise<void>;
}

export class MemoryWorkforceStateStore implements WorkforceStateStore {
  #snapshot?: WorkforceSnapshot;

  async load(): Promise<WorkforceSnapshot | undefined> {
    return this.#snapshot ? structuredClone(this.#snapshot) : undefined;
  }

  async save(snapshot: WorkforceSnapshot): Promise<void> {
    this.#snapshot = structuredClone(snapshot);
  }
}

export function captureWorkforceSnapshot(
  registry: WorkforceRegistry,
  queue: TaskQueue,
  now: () => Date = () => new Date(),
): WorkforceSnapshot {
  return {
    version: 1,
    savedAt: now().toISOString(),
    nodes: registry.listNodes(),
    employees: registry.listEmployees(),
    tasks: queue.list(),
  };
}

export function restoreWorkforceSnapshot(
  snapshot: WorkforceSnapshot,
  registry: WorkforceRegistry,
  queue: TaskQueue,
): void {
  if (snapshot.version !== 1) throw new Error(`unsupported workforce snapshot version ${snapshot.version}`);

  for (const node of snapshot.nodes) registry.registerNode(node);

  for (const employee of snapshot.employees) {
    const node = registry.getNode(employee.nodeId);
    const availability = node?.status === 'offline' ? 'offline' : node?.status === 'degraded' ? 'degraded' : 'idle';
    registry.registerEmployee({
      ...employee,
      availability,
      activeTaskCount: 0,
      currentTaskIds: [],
    });
  }

  for (const record of snapshot.tasks) restoreTaskRecord(record, queue);
}

function restoreTaskRecord(record: TaskRuntimeRecord, queue: TaskQueue): void {
  const canonical = queue.enqueue(record.task);
  const taskId = canonical.task.taskId;
  if (record.stage === 'cancelled') {
    throw new Error(`cancelled task restore is not supported for ${taskId}`);
  }

  if (record.attempts === 0) return;

  for (let attempt = 1; attempt <= record.attempts; attempt += 1) {
    const isLast = attempt === record.attempts;
    const employeeId = isLast && record.assignedEmployeeId ? record.assignedEmployeeId : `restore-${attempt}`;
    queue.assign(taskId, employeeId);
    queue.start(taskId);

    if (isLast && record.stage === 'completed') {
      if (!record.result) throw new Error(`completed task ${taskId} is missing result`);
      queue.complete(taskId, record.result);
      continue;
    }

    const failure = isLast && record.stage === 'failed' && record.result
      ? record.result
      : recoveryFailure(taskId, employeeId);
    queue.fail(taskId, failure);

    const mustRequeue = !isLast || ['queued', 'assigned', 'running'].includes(record.stage);
    if (mustRequeue && attempt < record.task.maxAttempts) queue.requeue(taskId);
  }
}

function recoveryFailure(taskId: string, employeeId: string): WorkerResult {
  return {
    taskId,
    employeeId,
    status: 'failed',
    conclusion: 'Recovered historical or in-flight attempt during workforce restart.',
    confidence: 0,
    artifacts: [],
    risks: ['restart-recovery'],
    completedAt: new Date(0).toISOString(),
    failure: {
      code: 'RESTART_RECOVERY',
      message: 'In-flight work is never assumed complete after restart; it is safely requeued when attempts remain.',
      retriable: true,
    },
  };
}

export class DurableWorkforceRuntime {
  readonly #adapters = new Map<WorkerKind, WorkerAdapter>();
  readonly #store?: WorkforceStateStore;
  #checkpointChain: Promise<void> = Promise.resolve();

  constructor(
    readonly registry: WorkforceRegistry,
    readonly queue: TaskQueue,
    readonly scheduler: CapabilityScheduler,
    store?: WorkforceStateStore,
  ) {
    this.#store = store;
  }

  static async restore(
    registry: WorkforceRegistry,
    queue: TaskQueue,
    scheduler: CapabilityScheduler,
    store: WorkforceStateStore,
  ): Promise<DurableWorkforceRuntime> {
    const snapshot = await store.load();
    if (snapshot) restoreWorkforceSnapshot(snapshot, registry, queue);
    return new DurableWorkforceRuntime(registry, queue, scheduler, store);
  }

  registerAdapter(adapter: WorkerAdapter): void {
    this.#adapters.set(adapter.kind, adapter);
  }

  async checkpoint(): Promise<void> {
    if (!this.#store) return;
    this.#checkpointChain = this.#checkpointChain.then(async () => {
      await this.#store?.save(captureWorkforceSnapshot(this.registry, this.queue));
    });
    await this.#checkpointChain;
  }

  async execute(task: TaskPacket, options: RuntimeScheduleOptions = {}): Promise<WorkerResult> {
    const existing = this.queue.enqueue(task);
    const canonicalTask = existing.task;
    const taskId = canonicalTask.taskId;
    await this.checkpoint();

    if (existing.stage === 'completed' && existing.result) return existing.result;
    if (existing.stage === 'failed' && existing.result?.failure?.retriable === false) return existing.result;

    const failedEmployees = new Set(options.excludeEmployeeIds ?? []);
    let finalResult: WorkerResult | undefined;

    while (this.queue.get(taskId).attempts < canonicalTask.maxAttempts) {
      const employee = this.#select(canonicalTask, options, failedEmployees);
      if (!employee) throw new Error(`no eligible employee for task ${taskId}`);
      const node = this.registry.getNode(employee.nodeId);
      if (!node) throw new Error(`node ${employee.nodeId} not found`);
      const adapter = this.#adapters.get(node.kind);
      if (!adapter) throw new Error(`no adapter registered for worker kind ${node.kind}`);

      this.queue.assign(taskId, employee.employeeId);
      this.registry.acquire(employee.employeeId, taskId);
      this.queue.start(taskId);
      await this.checkpoint();

      try {
        const result = validateRuntimeResult(await adapter.execute(canonicalTask, employee), canonicalTask, employee);
        finalResult = result;
        if (result.status === 'completed') {
          this.queue.complete(taskId, result);
          this.registry.release(employee.employeeId, taskId, true);
          await this.checkpoint();
          return result;
        }

        this.queue.fail(taskId, result);
        this.registry.release(employee.employeeId, taskId, false);
        failedEmployees.add(employee.employeeId);
        await this.checkpoint();
        if (!result.failure?.retriable) return result;
        this.queue.requeue(taskId);
        await this.checkpoint();
      } catch (error) {
        const result = runtimeFailure(taskId, employee.employeeId, error);
        finalResult = result;
        this.queue.fail(taskId, result);
        this.registry.release(employee.employeeId, taskId, false);
        failedEmployees.add(employee.employeeId);
        await this.checkpoint();
        this.queue.requeue(taskId);
        await this.checkpoint();
      }
    }

    if (finalResult) return finalResult;
    throw new Error(`task ${taskId} exhausted without a result`);
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
    const primaryProviders = providerSet(primary, this.registry);
    const reviewTask = makeReviewTask(primary);
    const review = await this.execute(reviewTask, {
      excludeEmployeeIds: reviewTask.reviewPolicy.independentReview ? primaryEmployees : [],
      preferredExcludeProviders: reviewTask.reviewPolicy.preferProviderDiversity ? primaryProviders : [],
    });
    if (review.status !== 'completed' || review.verdict !== 'pass') return { primary, review, passed: false };

    if (!reviewTask.reviewPolicy.judgeRequired || !makeJudgeTask) return { primary, review, passed: true };

    const judgeTask = makeJudgeTask(primary, review);
    const reviewer = this.registry.getEmployee(review.employeeId);
    const diversity = [
      ...primaryProviders,
      ...(reviewer?.provider ? [reviewer.provider] : []),
    ];
    const judgment = await this.execute(judgeTask, {
      excludeEmployeeIds: [...primaryEmployees, review.employeeId],
      preferredExcludeProviders: judgeTask.reviewPolicy.preferProviderDiversity ? diversity : [],
    });

    return {
      primary,
      review,
      judgment,
      passed: judgment.status === 'completed' && judgment.verdict === 'pass',
    };
  }

  #select(
    task: TaskPacket,
    options: RuntimeScheduleOptions,
    failedEmployees: Set<string>,
  ): EmployeeRecord | undefined {
    const excludeEmployeeIds = [...new Set([...(options.excludeEmployeeIds ?? []), ...failedEmployees])];
    const hardProviders = options.excludeProviders ?? [];
    const preferredProviders = options.preferredExcludeProviders ?? [];

    const preferred = this.scheduler.select(task, {
      excludeEmployeeIds,
      excludeProviders: [...hardProviders, ...preferredProviders],
    });
    if (preferred) return preferred;

    if (preferredProviders.length > 0) {
      return this.scheduler.select(task, {
        excludeEmployeeIds,
        excludeProviders: hardProviders,
      });
    }
    return undefined;
  }
}

function providerSet(results: WorkerResult[], registry: WorkforceRegistry): string[] {
  return [...new Set(results
    .map((result) => registry.getEmployee(result.employeeId)?.provider)
    .filter((provider): provider is string => Boolean(provider))
    .map((provider) => provider.toLowerCase()))];
}

function validateRuntimeResult(result: WorkerResult, task: TaskPacket, employee: EmployeeRecord): WorkerResult {
  if (result.taskId !== task.taskId) throw new Error('worker result taskId mismatch');
  if (result.employeeId !== employee.employeeId) throw new Error('worker result employeeId mismatch');
  if (result.confidence < 0 || result.confidence > 1) throw new Error('worker result confidence must be between 0 and 1');
  return structuredClone(result);
}

function runtimeFailure(taskId: string, employeeId: string, error: unknown): WorkerResult {
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
