import crypto from 'node:crypto';
import { storeEvidence } from '../../../packages/evidence/src/index.ts';

export function isZeroCost(labels) {
  if (!Array.isArray(labels)) return false;
  const hasZeroCostLabel = labels.some(l => {
    const name = typeof l === 'string' ? l : l?.name;
    return String(name || '').toLowerCase() === 'zero-cost-reversible';
  });
  return hasZeroCostLabel;
}

export function classifyRisk(title, body) {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  const highRiskKeywords = ['delete', 'production', 'credential', 'secret', 'billing', 'paid', 'drop', 'destroy'];
  const isHigh = highRiskKeywords.some(keyword => text.includes(keyword));
  return isHigh ? 'high' : 'low';
}

export function processGitHubIssue(payload) {
  const issue = payload?.issue;
  const labels = issue?.labels || [];
  const title = issue?.title || '';
  const body = issue?.body || '';

  if (!isZeroCost(labels)) {
    return {
      phase: 'rejected',
      status: 'blocked'
    };
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

  try {
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
  } catch (e) {
    // fallback if mock or store handles differently
  }

  return task;
}
