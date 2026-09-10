export type EmployeeState = 'active' | 'suspended' | 'revoked';
export type DeviceState = 'pending' | 'active' | 'lost' | 'revoked' | 'replaced';
export type ProviderState = 'active' | 'degraded' | 'disabled';
export type JobStage = 'queued' | 'leased' | 'reviewing' | 'judging' | 'done' | 'failed' | 'cancelled';
export type LeaseStatus = 'active' | 'completed' | 'expired' | 'revoked';
export type ResultStatus = 'completed' | 'failed';
export type ReviewRole = 'reviewer' | 'judge';
export type ReviewVerdict = 'pass' | 'needs-work' | 'fail';
export type EvidenceKind = 'text' | 'json' | 'log' | 'commit' | 'url' | 'screenshot';
export type WorkerKind = 'ai' | 'pc01' | 'device' | 'tool' | 'human';

export interface EmployeeRecord { employeeId:string; displayName:string; roles:string[]; permissions:string[]; capabilities:string[]; state:EmployeeState; concurrencyLimit:number; lastHeartbeatAt?:string; createdAt:string; updatedAt:string; }
export interface DeviceRecord { deviceId:string; platform:string; publicKeyFingerprint?:string; state:DeviceState; lastHeartbeatAt?:string; metadata:Record<string,unknown>; createdAt:string; updatedAt:string; }
export interface EmployeeDeviceBindingRecord { bindingId:string; employeeId:string; deviceId:string; state:'pending'|'active'|'revoked'|'replaced'; createdAt:string; updatedAt:string; }
export interface AiProviderRecord { providerId:string; provider:string; model:string; independenceKey:string; state:ProviderState; secretRef?:string; metadata:Record<string,unknown>; lastHeartbeatAt?:string; createdAt:string; updatedAt:string; }
export interface GoalRecord { goalId:string; idempotencyKey:string; objective:string; priority:'P0'|'P1'|'P2'|'P3'; constraints:string[]; maxParallelism:number; status:'planned'|'running'|'blocked'|'failed'|'completed'|'cancelled'; createdAt:string; updatedAt:string; }
export interface JobDefinition { jobId:string; goalId?:string; idempotencyKey:string; title:string; objective:string; payload:Record<string,unknown>; targetEmployeeId?:string; preferredProviderId?:string; requiredPermissions:string[]; requiredCapabilities:string[]; allowedWorkerKinds:WorkerKind[]; expectedEvidence:EvidenceKind[]; scopeKeys:string[]; dependencies:string[]; maxAttempts:number; independentReview:boolean; judgeRequired:boolean; priority:'P0'|'P1'|'P2'|'P3'; createdAt:string; }
export interface JobRecord extends JobDefinition { attempts:number; stage:JobStage; lastFailureCode?:string; updatedAt:string; }
export interface LeaseRecord { leaseId:string; jobId:string; employeeId:string; deviceId?:string; bindingId?:string; workerKind:WorkerKind; workerIndependenceKey:string; attempt:number; status:LeaseStatus; leasedAt:string; expiresAt:string; revokedAt?:string; }
export interface IssuedLease extends LeaseRecord { leaseToken:string; job:JobRecord; }
export interface EvidenceInput { kind:EvidenceKind; ref:string; summary?:string; sha256?:string; }
export interface EvidenceRecord extends EvidenceInput { evidenceId:string; jobId:string; resultId?:string; reviewId?:string; createdAt:string; }
export interface ResultFailure { code:string; message:string; retriable:boolean; }
export interface JobResultInput { jobId:string; employeeId:string; deviceId?:string; bindingId?:string; status:ResultStatus; output?:Record<string,unknown>; evidence:EvidenceInput[]; completedAt:string; failure?:ResultFailure; }
export interface ResultRecord extends JobResultInput { resultId:string; attempt:number; resultHash:string; createdAt:string; }
export interface PromptRecord { promptId:string; jobId:string; providerId?:string; model?:string; promptText:string; requestHash:string; attempt:number; createdAt:string; }
export interface PromptMetricsRecord { metricId:string; promptId:string; inputTokens?:number; outputTokens?:number; latencyMs?:number; providerAttempts:number; failoverCount:number; success:boolean; errorCode?:string; recordedAt:string; }
export interface ReviewInput { jobId:string; role:ReviewRole; reviewerId:string; independenceKey:string; verdict:ReviewVerdict; conclusion:string; evidence:EvidenceInput[]; retriable?:boolean; reviewedAt:string; }
export interface ReviewRecord extends ReviewInput { reviewId:string; attempt:number; }
export interface HeartbeatInput { employeeId:string; deviceId?:string; providerId?:string; at:string; health:'ok'|'degraded'|'offline'; metadata?:Record<string,unknown>; }
export interface LeaseJobRequest { employeeId:string; deviceId?:string; workerKind:WorkerKind; workerIndependenceKey:string; capabilities:string[]; permissions:string[]; leaseTtlMs?:number; now?:string; }
export interface RevokeLeaseRequest { jobId:string; leaseId:string; reason:string; requeue:boolean; at:string; }
export interface SubmitResultRequest { leaseId:string; leaseToken:string; result:JobResultInput; acceptedAt:string; }
export interface RecoverySummary { expiredLeases:number; requeuedJobs:number; terminalJobs:number; }
export interface JobStateSnapshot { job:JobRecord; lease?:LeaseRecord; result?:ResultRecord; evidence:EvidenceRecord[]; reviews:ReviewRecord[]; }
