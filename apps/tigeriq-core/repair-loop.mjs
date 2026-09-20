const retryStore = new Map();
const emittedRepairStore = new Set();

export const RepairDecision = Object.freeze({
  CI_FAIL: 'CI_FAIL',
  REVIEW_CHANGES: 'REVIEW_CHANGES',
  FAIL: 'FAIL',
  STALL: 'STALL',
  UNKNOWN: 'UNKNOWN'
});

export function normalizeFailure(decision) {
  const upper = String(decision || '').trim().toUpperCase();
  switch (upper) {
    case 'CI_FAIL':
      return RepairDecision.CI_FAIL;
    case 'REVIEW_CHANGES':
      return RepairDecision.REVIEW_CHANGES;
    case 'FAIL':
    case 'PROVIDER_FAIL':
    case 'FAILOVER':
      return RepairDecision.FAIL;
    case 'STALL':
    case 'BLOCK':
    case 'BLOCKED':
      return RepairDecision.STALL;
    default:
      return RepairDecision.UNKNOWN;
  }
}

export function trackRetry(failureId) {
  const id = String(failureId);
  const current = retryStore.get(id) || 0;
  const next = current + 1;
  retryStore.set(id, next);
  return next;
}

export function shouldBlock(retryCount, maxRetries = 3) {
  if (Number(retryCount) > Number(maxRetries)) {
    return { status: 'BLOCKED' };
  }
  return null;
}

export function processFailure(failureId, rawDecision) {
  const id = String(failureId);
  const decision = normalizeFailure(rawDecision);

  if (decision === RepairDecision.STALL) {
    return { status: 'BLOCKED', reason: 'STALL_DECISION' };
  }

  const retryCount = trackRetry(id);
  const blockCheck = shouldBlock(retryCount, 3);
  if (blockCheck) {
    return blockCheck;
  }

  if (emittedRepairStore.has(id)) {
    return { status: 'NOOP', reason: 'REPAIR_ALREADY_EMITTED', retryCount };
  }

  emittedRepairStore.add(id);

  let action = 'CREATE_PR';
  if (decision === RepairDecision.CI_FAIL) {
    action = 'FIX_CI_AND_CREATE_PR';
  } else if (decision === RepairDecision.REVIEW_CHANGES) {
    action = 'ADDRESS_REVIEW_AND_UPDATE_PR';
  } else if (decision === RepairDecision.FAIL) {
    action = 'FAILOVER_AND_CREATE_PR';
  }

  return {
    status: 'ACTION',
    action,
    decision,
    retryCount
  };
}
