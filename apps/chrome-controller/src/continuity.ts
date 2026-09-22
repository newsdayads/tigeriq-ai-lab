import type { WorkerId } from './model.js';
import { JobLedger, type UiJobRecord } from './job-ledger.js';

export interface ContinuityContext {
  workerId: WorkerId;
  ledger: JobLedger;
}

export function checkContinuity(context: ContinuityContext): { ok: boolean; activeJob?: UiJobRecord; reason?: string } {
  const active = context.ledger.active(context.workerId);
  if (!active) {
    return { ok: true, reason: 'NO_ACTIVE_JOB' };
  }
  return { ok: true, activeJob: active, reason: 'ACTIVE_JOB_PRESENT' };
}
