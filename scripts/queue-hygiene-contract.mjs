import { createHash } from 'node:crypto';

export function normalizeInstruction(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function workFingerprint(instruction) {
  return createHash('sha256').update(normalizeInstruction(instruction)).digest('hex').slice(0, 24);
}

const LIFECYCLE_MARKERS = new Map([
  ['TIGERIQ_PC01_CLAIMED', 'claimed'],
  ['TIGERIQ_JOB_CLAIMED', 'claimed'],
  ['TIGERIQ_COMMAND_CLAIMED', 'claimed'],
  ['TIGERIQ_PC01_DONE', 'completed'],
  ['TIGERIQ_PC01_RESULT', 'completed'],
  ['TIGERIQ_JOB_DONE', 'completed'],
  ['TIGERIQ_JOB_RESULT', 'completed'],
  ['TIGERIQ_COMMAND_RESULT', 'completed'],
  ['TIGERIQ_PC01_FAILED', 'failed'],
  ['TIGERIQ_JOB_FAILED', 'failed'],
  ['TIGERIQ_COMMAND_FAILED', 'failed'],
]);

function exactMarkerLines(body) {
  return String(body || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function lifecycleMarker(line) {
  const first = String(line || '').split(/\s+/, 1)[0];
  return LIFECYCLE_MARKERS.has(first) ? first : null;
}

export function lifecycleEvents(comments = []) {
  const rows = Array.isArray(comments) ? comments : [];
  const events = [];
  rows.forEach((comment, commentIndex) => {
    const body = typeof comment === 'string' ? comment : String(comment?.body || '');
    const createdAt = typeof comment === 'string' ? null : (comment?.created_at || comment?.createdAt || null);
    const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;
    exactMarkerLines(body).forEach((line, lineIndex) => {
      const marker = lifecycleMarker(line);
      if (!marker) return;
      events.push({ stage: LIFECYCLE_MARKERS.get(marker), marker, createdAt, timestamp: Number.isFinite(timestamp) ? timestamp : null, commentIndex, lineIndex });
    });
  });
  return events.sort((a, b) => {
    if (a.timestamp !== null && b.timestamp !== null && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.timestamp !== null && b.timestamp === null) return -1;
    if (a.timestamp === null && b.timestamp !== null) return 1;
    if (a.commentIndex !== b.commentIndex) return a.commentIndex - b.commentIndex;
    return a.lineIndex - b.lineIndex;
  });
}

export function latestLifecycleStage(comments = []) {
  const events = lifecycleEvents(comments);
  return events.length ? events[events.length - 1].stage : null;
}

export function issueEvidenceSummary(comments = []) {
  const rows = Array.isArray(comments) ? comments : [];
  const events = lifecycleEvents(rows);
  const stages = new Set(events.map(event => event.stage));
  const lines = rows.flatMap(comment => exactMarkerLines(typeof comment === 'string' ? comment : comment?.body));
  return { claimed: stages.has('claimed'), result: stages.has('completed'), failed: stages.has('failed'), reviewPass: lines.includes('REVIEW_PASS'), judgePass: lines.includes('JUDGE_PASS') };
}

export function issueStage(issue, comments = []) {
  if (issue?.state === 'closed' && ['not_planned', 'duplicate'].includes(String(issue?.state_reason || ''))) return 'cancelled';
  if (issue?.state === 'closed') return 'completed';
  return latestLifecycleStage(comments) || 'queued';
}

export function issuePriority(issue) {
  const body = String(issue?.body || '');
  const field = body.match(/(?:^|\n)## Priority\s*\n\s*(P[012])\s*(?:\n|$)/i);
  if (field) return field[1].toUpperCase();
  const title = String(issue?.title || '');
  const titleMatch = title.match(/(?:^|[^A-Z0-9])(P[012])(?:[^A-Z0-9]|$)/i);
  return titleMatch ? titleMatch[1].toUpperCase() : null;
}

export function issueType(issue) {
  const body = String(issue?.body || '');
  if (body.includes('TIGERIQ_COMMAND_V1')) return 'command';
  if (body.includes('TIGERIQ_JOB_V1')) return 'work-order';
  return 'unknown';
}

export function workItemSummary(issue, comments = [], nowMs = Date.now()) {
  const stage = issueStage(issue, comments);
  const evidence = issueEvidenceSummary(comments);
  const updatedAt = issue?.updated_at || issue?.updatedAt || null;
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const ageMinutes = Number.isFinite(updatedMs) ? Math.max(0, Math.floor((nowMs - updatedMs) / 60000)) : null;
  const stale = (stage === 'queued' || stage === 'claimed') && ageMinutes !== null && ageMinutes >= 30;
  return { number: Number(issue?.number || 0), title: String(issue?.title || ''), state: String(issue?.state || 'unknown'), stateReason: issue?.state_reason || null, stage, priority: issuePriority(issue), type: issueType(issue), url: issue?.html_url || issue?.url || null, updatedAt, ageMinutes, stale, evidence };
}
