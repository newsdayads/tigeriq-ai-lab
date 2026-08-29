export const GATES = [
  'CODE',
  'REVIEW',
  'TEST',
  'TYPECHECK',
  'BUILD',
  'CI',
  'PREVIEW',
  'PREVIEW_SMOKE',
  'MERGE_MAIN',
  'PRODUCTION',
  'PRODUCTION_SMOKE',
  'DOCS_CURRENT_STATE',
  'DONE'
] as const;

export type Gate = (typeof GATES)[number];
export type GateStatus = 'pending' | 'running' | 'pass' | 'fail' | 'blocked';

export interface GateEvidence {
  gate: Gate;
  status: GateStatus;
  commitSha?: string;
  command?: string;
  exitCode?: number;
}

export function canAdvance(current: Gate, evidence: GateEvidence[]): boolean {
  const record = evidence.find((item) => item.gate === current);
  if (!record || record.status !== 'pass') return false;
  if (current === 'DONE') return true;
  return Boolean(record.commitSha && record.command && record.exitCode === 0);
}

export function nextGate(current: Gate): Gate {
  const index = GATES.indexOf(current);
  if (index < 0 || index === GATES.length - 1) return 'DONE';
  return GATES[index + 1];
}
