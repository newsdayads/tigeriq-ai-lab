export type EvidenceStatus = 'pass' | 'fail' | 'error';

export interface EvidenceRecord {
  id: string;
  workOrderId: string;
  gate: string;
  commitSha: string;
  command: string;
  exitCode: number;
  status: EvidenceStatus;
  artifactUris?: string[];
  logDigest?: string;
  timestamp: string;
  latencyMetrics?: {
    queuedAt?: string;
    claimedAt?: string;
    workingAt?: string;
    evidenceAt?: string;
    doneAt?: string;
    durationMs?: number;
  };
}

export function isPassingEvidence(record: EvidenceRecord): boolean {
  return record.status === 'pass' && record.exitCode === 0 && record.commitSha.length >= 7 && record.command.length > 0;
}
