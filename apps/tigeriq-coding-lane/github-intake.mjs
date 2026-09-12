import crypto from 'node:crypto';
import { isPassingEvidence } from '../../packages/evidence/src/index.js';

// Global in‑memory evidence store (used when no custom store is provided)
const _evidenceStore = [];
function defaultStoreEvidence(record) {
  // Validate against the evidence schema via the helper
  if (!isPassingEvidence(record)) {
    throw new Error('InvalidEvidenceRecord');
  }
  _evidenceStore.push(record);
}

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
 * @returns {object} Task description or rejection result.
 */
export function processGitHubIssue(payload) {
  const issue = payload?.issue;
  const labels = issue?.labels || [];
  const title = issue?.title || '';
  const body = issue?.body || '';

  // 1️⃣ Validation: must be zero‑cost and must not request paid resources.
  if (!isZeroCost(labels)) return { phase: 'rejected', status: 'blocked' };
  const paidKeywords = ['paid', 'billing', 'cost'];
  const combined = `${title} ${body}`.toLowerCase();
  if (paidKeywords.some(k => combined.includes(k))) {
    return { phase: 'rejected', status: 'blocked' };
  }

  // 2️⃣ Risk classification
  const risk = classifyRisk(title, body);

  // 3️⃣ Create base task (intake phase, pending status)
  const taskId = crypto.randomUUID();
  const baseTask = {
    id: taskId,
    source: 'github',
    issueNumber: issue?.number,
    phase: 'intake',
    status: 'pending',
    owner: null,
    reviewer: null,
    retryCount: 0,
    blocker: null,
    authorizationNeeded: false,
    metadata: {
      title,
      body,
      labels: labels.map(l => (typeof l === 'string' ? l : l?.name))
    }
  };

  // 4️⃣ Persist evidence for the intake operation
  const evidenceRecord = {
    id: crypto.randomUUID(),
    workOrderId: taskId,
    gate: 'github-intake',
    commitSha: '0000000000000000000000000000000000000000',
    command: 'processGitHubIssue',
    exitCode: 0,
    status: 'pass',
    timestamp: new Date().toISOString()
  };
  defaultStoreEvidence(evidenceRecord);

  // 5️⃣ Advance phase based on risk
  if (risk === 'low') {
    baseTask.phase = 'plan';
    baseTask.status = 'ready';
    baseTask.owner = 'autonomous-manager';
    baseTask.authorizationNeeded = false;
    baseTask.blocker = null;
  } else {
    // high‑risk handling
    baseTask.status = 'awaiting-review';
    baseTask.authorizationNeeded = true;
    baseTask.blocker = 'High-risk task requires manual reviewer assignment';
    // phase remains 'intake' as per specification
  }

  return baseTask;
}

// Export the in‑memory store for potential test introspection (optional)
export const __evidenceStore = _evidenceStore;
