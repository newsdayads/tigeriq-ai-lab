import crypto from 'node:crypto';

export function isZeroCost(labels) {
  if (!Array.isArray(labels)) return false;
  return labels.some(l => {
    const name = typeof l === 'string' ? l : l?.name;
    return String(name || '').toLowerCase() === 'zero-cost-reversible';
  });
}

export function classifyRisk(title, body) {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  const highRiskKeywords = ['delete', 'production', 'credential', 'secret', 'billing', 'paid', 'drop', 'destroy'];
  return highRiskKeywords.some(keyword => text.includes(keyword)) ? 'high' : 'low';
}

/**
 * Process a GitHub issue payload into a task and persist evidence.
 * @param {object} payload GitHub webhook payload containing an `issue` object.
 * @param {object} [options]
 * @param {function} [options.storeEvidence] Optional injection for persisting evidence records.
 * @returns {object} Task description or rejection result.
 */
export function processGitHubIssue(payload, { storeEvidence = () => {} } = {}) {
  const issue = payload?.issue;
  const labels = issue?.labels || [];
  const title = issue?.title || '';
  const body = issue?.body || '';

  // Validation: must be zero‑cost and must not request paid resources.
  if (!isZeroCost(labels)) return { phase: 'rejected', status: 'blocked' };
  const paidKeywords = ['paid', 'billing', 'cost'];
  const combined = `${title} ${body}`.toLowerCase();
  if (paidKeywords.some(k => combined.includes(k))) {
    return { phase: 'rejected', status: 'blocked' };
  }

  const risk = classifyRisk(title, body);
  const taskId = crypto.randomUUID();
  const task = {
    id: taskId,
    source: 'github',
    issueNumber: issue?.number,
    phase: risk === 'high' ? 'intake' : 'plan',
    status: risk === 'high' ? 'awaiting-review' : 'ready',
    owner: risk === 'high' ? null : 'autonomous-manager',
    reviewer: null,
    retryCount: 0,
    blocker: risk === 'high' ? 'High-risk task requires manual reviewer assignment' : null,
    authorizationNeeded: risk === 'high',
    metadata: {
      title,
      body,
      labels: labels.map(l => (typeof l === 'string' ? l : l?.name))
    }
  };

  // Persist evidence record (mockable via storeEvidence).
  storeEvidence({
    id: crypto.randomUUID(),
    workOrderId: taskId,
    gate: 'github-intake',
    commitSha: '0000000000000000000000000000000000000000',
    command: 'processGitHubIssue',
    exitCode: 0,
    status: 'pass',
    timestamp: new Date().toISOString()
  });

  return task;
}
