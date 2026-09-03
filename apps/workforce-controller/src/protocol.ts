export const PC01_CONTROLLER_PROTOCOL = Object.freeze({
  name: 'controller-v1',
  host: '100.97.23.87',
  port: 8790,
  statusPath: '/api/v1/status',
  leasePath: '/api/v1/jobs/lease',
  resultPath(jobId:string){return `/api/v1/jobs/${encodeURIComponent(jobId)}/result`;},
  heartbeatPath(deviceId:string){return `/api/v1/devices/${encodeURIComponent(deviceId)}/heartbeat`;},
  datastore: 'postgres-operational-state-v1',
  migration: '001_operational_state_v1',
  workerKind: 'device',
  deviceProofVersion: '1',
} as const);

export const DEVICE_PROOF_HEADER_NAMES = Object.freeze([
  'X-TigerIQ-Device-Proof-V',
  'X-TigerIQ-Employee-Id',
  'X-TigerIQ-Node-Id',
  'X-TigerIQ-Device-Id',
  'X-TigerIQ-Device-Key-Fingerprint',
  'X-TigerIQ-Device-Public-Key',
  'X-TigerIQ-Device-Timestamp',
  'X-TigerIQ-Device-Nonce',
  'X-TigerIQ-Device-Challenge',
  'X-TigerIQ-Device-Signature',
] as const);

export const DEVICE_PROOF_CANONICAL_FIELDS = Object.freeze([
  'METHOD','PATH','EMPLOYEE_ID','NODE_ID','DEVICE_ID','TIMESTAMP_MS','NONCE','SHA256_BODY_BYTES',
] as const);
