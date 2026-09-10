import type { OperationalStateRepository } from './repository.js';
import type { AiProviderRecord,DeviceRecord,EmployeeDeviceBindingRecord,EmployeeRecord,GoalRecord,HeartbeatInput,JobDefinition,LeaseJobRequest,PromptMetricsRecord,PromptRecord,ReviewInput,RevokeLeaseRequest,SubmitResultRequest } from './types.js';
/** Transport-neutral contract for PC01 Controller, Android workers and AI workers. */
export class OperationalWorkService {
  constructor(readonly repository:OperationalStateRepository) {}
  upsertEmployee(record:EmployeeRecord){return this.repository.upsertEmployee(record);}
  upsertDevice(record:DeviceRecord){return this.repository.upsertDevice(record);}
  bindDevice(record:EmployeeDeviceBindingRecord){return this.repository.bindDevice(record);}
  upsertAiProvider(record:AiProviderRecord){return this.repository.upsertAiProvider(record);}
  createGoal(record:GoalRecord){return this.repository.createGoal(record);}
  createJob(job:JobDefinition){return this.repository.createJob(job);}
  getJob(jobId:string){return this.repository.getJob(jobId);}
  assignNextJob(request:LeaseJobRequest){return this.repository.leaseNextJob(request);}
  revokeJob(request:RevokeLeaseRequest){return this.repository.revokeLease(request);}
  submitResult(request:SubmitResultRequest){return this.repository.submitResult(request);}
  heartbeat(input:HeartbeatInput){return this.repository.heartbeat(input);}
  recoverAfterRestart(at=new Date().toISOString()){return this.repository.recoverExpiredLeases(at);}
  recordReview(input:ReviewInput){return this.repository.recordReview(input);}
  recordPrompt(input:PromptRecord){return this.repository.recordPrompt(input);}
  recordPromptMetrics(input:PromptMetricsRecord){return this.repository.recordPromptMetrics(input);}
}
