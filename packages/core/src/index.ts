export type GateStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'BLOCKED';

export interface EvidenceRef {
  id: string;
  kind: 'command' | 'test-report' | 'build-artifact' | 'review' | 'external-check';
  uri: string;
  sha256?: string;
  collectedAt: string;
}

export interface GateDecision {
  gateId: string;
  status: GateStatus;
  evidence: EvidenceRef[];
  evaluatedBy: string;
  evaluatedAt: string;
}

/** A gate cannot pass without evidence and cannot be self-approved by its implementer. */
export function canVerify(decision: GateDecision, implementer: string): boolean {
  return decision.status === 'PASSED' && decision.evidence.length > 0 && decision.evaluatedBy !== implementer;
}
