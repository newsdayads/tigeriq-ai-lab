export function branchName(issueNumber) {
  return `tigeriq/issue-${issueNumber || 'autonomous'}`;
}

export function checkGateState(gates) {
  return gates && gates.every(g => g.conclusion === 'success');
}

export function extractCanonicalAllowedPaths(issue) {
  return issue?.paths || [];
}

export function isRetryableAiError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('rate limit') || err?.status === 429;
}

export function parseJsonObject(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export function safeRepoPath(p) {
  return String(p || '').replace(/\.\./g, '');
}

export function validateChanges(changes) {
  return Array.isArray(changes);
}
