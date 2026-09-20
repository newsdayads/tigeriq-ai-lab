import { selectIdleWorkers } from './worker-selection.mjs';
import { getViewportPolicy } from './viewport-policy.mjs';
import { runBrowserAudit } from './browser-audit-adapter.mjs';
const seenHandoffs = new Set();

function generateSignature(targetUrl, cycleIndex, auditResult) {
  const str = `${targetUrl}:${cycleIndex}:${JSON.stringify(auditResult)}`;
  return btoa(str);
}

function isSafeForQueue(auditResult) {
  return auditResult.status === 'audit_complete' && (auditResult.score === undefined || auditResult.score > 50) && auditResult.sweepVerified;
}

export async function processRepairHandoff(targetUrl, cycleIndex) {
  const workers = await selectIdleWorkers();
  const { rotation } = getViewportPolicy(cycleIndex);
  const auditResult = await runBrowserAudit(targetUrl, rotation);
  const signature = generateSignature(targetUrl, cycleIndex, auditResult);
  if (seenHandoffs.has(signature)) return null;
  seenHandoffs.add(signature);

  const handoff = {
    id: signature,
    timestamp: Date.now(),
    target: targetUrl,
    cycle: cycleIndex,
    workersCount: workers.length,
    audit: auditResult.status
  };

  if (isSafeForQueue(auditResult)) {
    // Enqueue Coding Lane repair objectives
    console.log('Enqueued:', handoff);
  }

  return handoff;
}
