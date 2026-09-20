import { selectIdleWorkers } from './worker-selection.mjs';
import { getViewportPolicy } from './viewport-policy.mjs';
import { runBrowserAudit } from './browser-audit-adapter.mjs';

function generateSignature(targetUrl, cycleIndex, auditResult) {
  const str = `${targetUrl}:${cycleIndex}:${auditResult.status}`;
  return btoa(str);
}

function isSafeForQueue(auditResult) {
  return auditResult.status === 'audit_complete' && auditResult.score > 50;
}

export async function processRepairHandoff(targetUrl, cycleIndex) {
  const workers = await selectIdleWorkers();
  const { fullHD } = getViewportPolicy(cycleIndex);
  const auditResult = await runBrowserAudit(targetUrl, fullHD);
  const signature = generateSignature(targetUrl, cycleIndex, auditResult);

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
