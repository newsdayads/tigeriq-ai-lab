import type { OperationalStateRepository } from './repository.js';
import type { HeartbeatInput,JobDefinition,LeaseJobRequest,PromptMetricsRecord,PromptRecord,ReviewInput,RevokeLeaseRequest,SubmitResultRequest } from './types.js';
/** Transport-neutral contract for PC01 Controller, Android workers and AI workers. */
export class OperationalWorkService {
  constructor(readonly repository:OperationalStateRepository) {}
  createJob(job:JobDefinition){return this.repository.createJob(job);}
  assignNextJob(request:LeaseJobRequest){return this.repository.leaseNextJob(request);}
  revokeJob(request:RevokeLeaseRequest){return this.repository.revokeLease(request);}
  submitResult(request:SubmitResultRequest){return this.repository.submitResult(request);}
  heartbeat(input:HeartbeatInput){return this.repository.heartbeat(input);}
  recoverAfterRestart(at=new Date().toISOString()){return this.repository.recoverExpiredLeases(at);}
  recordReview(input:ReviewInput){return this.repository.recordReview(input);}
  recordPrompt(input:PromptRecord){return this.repository.recordPrompt(input);}
  recordPromptMetrics(input:PromptMetricsRecord){return this.repository.recordPromptMetrics(input);}
}
