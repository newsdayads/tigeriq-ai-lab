import { getFailureLedger } from './ai-json-transport.mjs';

export function isRetryableFailure(failureCode) {
  return ['CI_GATES_FAILED', 'CI_GATES_TIMEOUT', 'TIMEOUT', 'RATE_LIMIT'].includes(failureCode);
}

export function shouldRetry(attempt, maxAttempts = 3) {
  return attempt < maxAttempts;
}

export function isStaleJob(job, now = Date.now(), maxDurationMs = 45 * 60 * 1000) {
  if (job?.status !== 'running') return false;
  const started = Date.parse(job.started_at || 0);
  return !isNaN(started) && (now - started) > maxDurationMs;
}

export function extractGitHubIssueNumber(text) {
  const match = String(text || '').match(/(?:issue #|issues\/)(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

export function repairInstruction(job, failureCode, attempt) {
  const ledger = getFailureLedger();
  return `${job.instruction || ''}
AUTONOMOUS_REPAIR_CYCLE=${attempt}
PREVIOUS_FAILURE=${failureCode}
FAILURE_LEDGER=${JSON.stringify(ledger)}
Do not broaden scope.`;
}
