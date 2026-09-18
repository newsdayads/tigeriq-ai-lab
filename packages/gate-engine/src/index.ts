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

export interface VerificationGateResult {
  verified: boolean;
  reason?: string;
}

export function verificationGate(current: Gate, evidence: GateEvidence[]): VerificationGateResult {
  const passed = canAdvance(current, evidence);
  if (!passed) {
    return { verified: false, reason: `Gate ${current} evidence incomplete or failing` };
  }
  return { verified: true };
}

export function nextGate(current: Gate): Gate {
  const index = GATES.indexOf(current);
  if (index < 0 || index === GATES.length - 1) return 'DONE';
  return GATES[index + 1];
}

export interface WorkOrderPreflightInput {
  required_skill?: string;
  required_tools?: string[];
  required_state_refs?: string[];
  strict_preflight?: boolean;
}

export function gateValidatePreflight(workOrder: WorkOrderPreflightInput = {}): { valid: boolean; legacy: boolean; reasons: string[] } {
  const reqSkill = workOrder.required_skill;
  const reqTools = workOrder.required_tools;
  const reqStateRefs = workOrder.required_state_refs;
  const isLegacy = !reqSkill && !reqTools && !reqStateRefs && !workOrder.strict_preflight;
  if (isLegacy) {
    return { valid: true, legacy: true, reasons: [] };
  }
  const reasons: string[] = [];
  if (!reqSkill) reasons.push('MISSING_REQUIRED_SKILL');
  if (!Array.isArray(reqTools) || reqTools.length === 0) reasons.push('MISSING_REQUIRED_TOOLS');
  if (!Array.isArray(reqStateRefs) || reqStateRefs.length === 0) reasons.push('MISSING_REQUIRED_STATE_REFS');
  return {
    valid: reasons.length === 0,
    legacy: false,
    reasons,
  };
}
