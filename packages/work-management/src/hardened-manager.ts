import { AutonomousWorkManager as BaseAutonomousWorkManager } from './manager.js';
import type { WorkManagementStateStore } from './journal-store.js';
import { WorkManagementStore } from './store.js';
import type {
  ExecutionResult,
  ManagedWorker,
  PlannedWorkItem,
  ReviewResult,
  WorkDriver,
  WorkRole,
} from './types.js';

type Registration = {
  independenceKey: string;
  roles: WorkRole[];
};

/**
 * Security/correctness wrapper for the autonomous manager.
 *
 * It keeps the existing scheduling/store implementation but closes three gates:
 * 1. one underlying identity cannot be registered across Executor/Reviewer/Judge roles;
 * 2. completed execution must satisfy the work item's declared evidence kinds;
 * 3. every external driver call has a wall-clock deadline and an AbortSignal.
 */
export class AutonomousWorkManager extends BaseAutonomousWorkManager {
  readonly #registrations = new Map<string, Registration>();
  readonly #driverTimeoutMs: number;

  constructor(
    store: WorkManagementStore,
    leaseMs = 5 * 60_000,
    stateStore?: WorkManagementStateStore,
    driverTimeoutMs = leaseMs,
  ) {
    super(store, leaseMs, stateStore);
    if (!Number.isFinite(driverTimeoutMs) || driverTimeoutMs < 1) throw new Error('driverTimeoutMs must be >= 1');
    this.#driverTimeoutMs = driverTimeoutMs;
  }

  override registerWorker(worker: ManagedWorker, driver: WorkDriver): void {
    const independenceKey = worker.independenceKey.trim().toLowerCase();
    if (!independenceKey) throw new Error(`worker ${worker.workerId} independenceKey is required`);

    const next = new Map(this.#registrations);
    next.set(worker.workerId, { independenceKey, roles: [...worker.roles] });
    assertIndependentRoleRegistration(next);

    this.#registrations.clear();
    for (const [workerId, registration] of next) this.#registrations.set(workerId, registration);
    super.registerWorker(worker, this.#wrapDriver(driver));
  }

  #wrapDriver(driver: WorkDriver): WorkDriver {
    const wrapped: WorkDriver = {};

    if (driver.execute) {
      wrapped.execute = async (context) => {
        try {
          const result = await withDeadline(
            this.#driverTimeoutMs,
            (signal) => driver.execute!({ ...context, signal }),
          );
          return enforceExpectedEvidence(context.work, result);
        } catch (error) {
          if (isTimeout(error)) {
            return {
              status: 'failed',
              conclusion: 'Execution driver exceeded the bounded wall-clock deadline.',
              evidence: [],
              failureCode: 'WORK_DRIVER_TIMEOUT',
              retriable: true,
            };
          }
          throw error;
        }
      };
    }

    if (driver.review) {
      wrapped.review = async (context) => {
        try {
          return await withDeadline(
            this.#driverTimeoutMs,
            (signal) => driver.review!({ ...context, signal }),
          );
        } catch (error) {
          if (isTimeout(error)) return timeoutReview('Review');
          throw error;
        }
      };
    }

    if (driver.judge) {
      wrapped.judge = async (context) => {
        try {
          return await withDeadline(
            this.#driverTimeoutMs,
            (signal) => driver.judge!({ ...context, signal }),
          );
        } catch (error) {
          if (isTimeout(error)) return timeoutReview('Judge');
          throw error;
        }
      };
    }

    return wrapped;
  }
}

function assertIndependentRoleRegistration(registrations: Map<string, Registration>): void {
  const rolesByIdentity = new Map<string, Set<WorkRole>>();
  for (const registration of registrations.values()) {
    const roles = rolesByIdentity.get(registration.independenceKey) ?? new Set<WorkRole>();
    for (const role of registration.roles) roles.add(role);
    rolesByIdentity.set(registration.independenceKey, roles);
  }

  for (const [identity, roles] of rolesByIdentity) {
    if (roles.size > 1) {
      throw new Error(
        `independence identity ${identity} cannot span multiple assurance roles: ${[...roles].sort().join(',')}`,
      );
    }
  }
}

function enforceExpectedEvidence(work: PlannedWorkItem, result: ExecutionResult): ExecutionResult {
  if (result.status !== 'completed') return result;
  const presentKinds = new Set(result.evidence.map((item) => item.kind));
  const missing = work.expectedEvidence.filter((kind) => !presentKinds.has(kind));
  if (missing.length === 0) return result;
  return {
    status: 'failed',
    conclusion: `Execution did not satisfy declared evidence contract: missing ${missing.join(', ')}.`,
    evidence: result.evidence,
    failureCode: 'EXPECTED_EVIDENCE_MISSING',
    retriable: true,
  };
}

function timeoutReview(role: 'Review' | 'Judge'): ReviewResult {
  return {
    verdict: 'needs-work',
    conclusion: `${role} driver exceeded the bounded wall-clock deadline.`,
    evidence: [],
    retriable: true,
  };
}

const TIMEOUT = Symbol('work-driver-timeout');

async function withDeadline<T>(timeoutMs: number, invoke: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke(controller.signal),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(TIMEOUT);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTimeout(error: unknown): boolean {
  return error === TIMEOUT;
}
