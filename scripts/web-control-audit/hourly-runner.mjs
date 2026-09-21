import { processRepairHandoff } from './repair-handoff.mjs';

export async function runHourlyAuditCycle(targetUrls) {
  const results = [];
  let cycleIndex = 0;
  for (const url of targetUrls) {
    try {
      const handoff = await processRepairHandoff(url, cycleIndex++);
      results.push({ url, status: 'success', handoff });
    } catch (err) {
      results.push({ url, status: 'failed', error: err.message });
    }
  }
  return results;
}
