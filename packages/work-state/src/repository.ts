import type { AiProviderRecord, DeviceRecord, EmployeeDeviceBindingRecord, EmployeeRecord, GoalRecord, HeartbeatInput, IssuedLease, JobDefinition, JobRecord, JobStateSnapshot, LeaseJobRequest, PromptMetricsRecord, PromptRecord, RecoverySummary, ResultRecord, ReviewInput, ReviewRecord, RevokeLeaseRequest, SubmitResultRequest } from './types.js';

export interface OperationalStateRepository {
  upsertEmployee(record:EmployeeRecord):Promise<EmployeeRecord>;
  upsertDevice(record:DeviceRecord):Promise<DeviceRecord>;
  bindDevice(record:EmployeeDeviceBindingRecord):Promise<EmployeeDeviceBindingRecord>;
  upsertAiProvider(record:AiProviderRecord):Promise<AiProviderRecord>;
  createGoal(record:GoalRecord):Promise<GoalRecord>;
  createJob(job:JobDefinition):Promise<JobRecord>;
  getJob(jobId:string):Promise<JobStateSnapshot|undefined>;
  leaseNextJob(request:LeaseJobRequest):Promise<IssuedLease|undefined>;
  revokeLease(request:RevokeLeaseRequest):Promise<JobRecord>;
  submitResult(request:SubmitResultRequest):Promise<ResultRecord>;
  heartbeat(input:HeartbeatInput):Promise<void>;
  recoverExpiredLeases(at:string):Promise<RecoverySummary>;
  recordPrompt(record:PromptRecord):Promise<PromptRecord>;
  recordPromptMetrics(record:PromptMetricsRecord):Promise<PromptMetricsRecord>;
  recordReview(input:ReviewInput):Promise<ReviewRecord>;
}
