import { AndroidV07Registry } from './registry.js';
import { DurableAndroidJobQueue } from './queue.js';
import type {
  AndroidJob,
  AndroidJobResult,
  PullJobRequest,
  PullJobResponse,
  SubmitJobResultRequest,
  SubmitJobResultResponse,
} from './types.js';

export class AndroidThinWorkerApi {
  constructor(private readonly queue: DurableAndroidJobQueue) {}

  async pull(request: PullJobRequest): Promise<PullJobResponse> {
    const lease = await this.queue.pull(request.employeeId, request.deviceId);
    return lease ? { kind: 'job', lease } : { kind: 'empty' };
  }

  async submit(request: SubmitJobResultRequest): Promise<SubmitJobResultResponse> {
    const result = await this.queue.submit(
      request.employeeId,
      request.deviceId,
      request.leaseId,
      request.leaseToken,
      request.result,
    );
    return {
      accepted: true,
      result,
      evidenceNamespace: `${AndroidV07Registry.namespaces(request.employeeId).evidence}:job:${result.jobId}`,
    };
  }
}

export type MockJobExecutor = (
  job: AndroidJob,
) => Promise<Omit<AndroidJobResult, 'jobId' | 'employeeId' | 'deviceId' | 'bindingId' | 'completedAt'>>;

/** Thin-worker simulator only. It executes a supplied deterministic callback and never selects/calls an AI provider. */
export class MockAndroidThinWorker {
  constructor(
    readonly employeeId: string,
    readonly deviceId: string,
    private readonly api: AndroidThinWorkerApi,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runOnce(execute: MockJobExecutor): Promise<AndroidJobResult | undefined> {
    const pulled = await this.api.pull({ employeeId: this.employeeId, deviceId: this.deviceId });
    if (pulled.kind === 'empty') return undefined;
    const lease = pulled.lease;
    const partial = await execute(lease.job);
    const result: AndroidJobResult = {
      ...partial,
      jobId: lease.jobId,
      employeeId: this.employeeId,
      deviceId: this.deviceId,
      bindingId: lease.bindingId,
      completedAt: this.now().toISOString(),
    };
    return (await this.api.submit({
      employeeId: this.employeeId,
      deviceId: this.deviceId,
      leaseId: lease.leaseId,
      leaseToken: lease.leaseToken,
      result,
    })).result;
  }
}
