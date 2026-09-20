import fs from 'node:fs';
import path from 'node:path';

export function generateRepairHandoff(auditResult, handoffDir = 'D:/TigerIQ/Evidence/repair-handoffs') {
  fs.mkdirSync(handoffDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const handoffId = `handoff-${timestamp}`;
  const filePath = path.join(handoffDir, `${handoffId}.json`);
  
  const handoff = {
    id: handoffId,
    at: new Date().toISOString(),
    source: 'web-control-audit',
    status: 'PENDING_CODING_LANE',
    failures: auditResult.failures || [],
    metrics: auditResult.metrics || {}
  };
  
  fs.writeFileSync(filePath, JSON.stringify(handoff, null, 2));
  return { filePath, handoff };
}
