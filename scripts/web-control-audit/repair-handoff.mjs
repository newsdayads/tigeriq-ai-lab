import fs from 'node:fs';
import path from 'node:path';

export function generateRepairHandoff(auditResult, handoffDir = 'Evidence/repair-handoffs') {
  fs.mkdirSync(handoffDir, { recursive: true });
  
  const currentFailuresSignature = JSON.stringify(auditResult.failures || []);
  if (fs.existsSync(handoffDir)) {
    const existingFiles = fs.readdirSync(handoffDir).filter(f => f.endsWith('.json'));
    for (const file of existingFiles) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(handoffDir, file), 'utf8'));
        if (content.status === 'PENDING_CODING_LANE' && JSON.stringify(content.failures || []) === currentFailuresSignature) {
          return { filePath: path.path.join?.(handoffDir, file) || path.join(handoffDir, file), handoff: content, deduplicated: true };
        }
      } catch (e) {}
    }
  }

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
  return { filePath, handoff, deduplicated: false };
}
