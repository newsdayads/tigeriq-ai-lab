import { verifyServerGateComment } from './cloud-workforce.mjs';

const SERVER_GATE_SLUG = 'tigeriq-server-attested';
const configuredGateSlugs = String(process.env.TIGERIQ_REVIEW_GATE_APP_SLUGS || 'chatgpt-codex-connector')
  .split(',').map((value) => value.trim()).filter(Boolean);
if (!configuredGateSlugs.includes(SERVER_GATE_SLUG)) {
  process.env.TIGERIQ_REVIEW_GATE_APP_SLUGS = [...configuredGateSlugs, SERVER_GATE_SLUG].join(',');
}

const legacy = await import('./control-legacy.mjs');

function serverTrustedComments(comments = []) {
  return (Array.isArray(comments) ? comments : []).map((comment) => {
    if (!comment || typeof comment === 'string' || !verifyServerGateComment(comment.body)) return comment;
    return {
      ...comment,
      performed_via_github_app: { ...(comment.performed_via_github_app || {}), slug: SERVER_GATE_SLUG },
    };
  });
}

export const normalizeInstruction = legacy.normalizeInstruction;
export const workFingerprint = legacy.workFingerprint;
export const lifecycleEvents = legacy.lifecycleEvents;
export const latestLifecycleStage = legacy.latestLifecycleStage;
export const issuePriority = legacy.issuePriority;
export const issueType = legacy.issueType;

export function issueEvidenceSummary(comments = []) {
  return legacy.issueEvidenceSummary(serverTrustedComments(comments));
}

export function issueStage(issue, comments = []) {
  return legacy.issueStage(issue, serverTrustedComments(comments));
}

export function workItemSummary(issue, comments = [], nowMs = Date.now()) {
  return legacy.workItemSummary(issue, serverTrustedComments(comments), nowMs);
}

const { default: singleDoorHandler } = await import('./single-door.mjs');
export default singleDoorHandler;
