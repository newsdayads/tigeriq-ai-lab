// REA GH-4780 R05: diagnostic only; NEVER owns or releases a Core lease.
// Supplied /api/live-status projection is untrusted, not an authenticated claim.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const rec = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const report = (decision, counts) => ({
  decision, resourceScope: 'TIGERIQ_REA_RECONSTRUCTION_LAB_V1',
  employee: 'NV02', sourceAuthenticated: false, leaseOwned: false,
  deviceAuthorized: false, installAuthorized: false, mutated: false,
  ...(counts ? { counts } : {})
});
export function inspectR05ReadOnly(snapshot, nowMs = Date.now()) {
  if (!Number.isFinite(nowMs) || !rec(snapshot) || snapshot.ok !== true ||
      !rec(snapshot.core) || typeof snapshot.core.time !== 'string' ||
      !Array.isArray(snapshot.resources) || !Array.isArray(snapshot.sharedLeases) ||
      !Array.isArray(snapshot.jobs)) return report('INVALID_SHAPE');
  if ([snapshot.resources, snapshot.jobs, snapshot.sharedLeases].some(v => v.length > 256))
    return report('OVERSIZED_SNAPSHOT');
  const t = snapshot.core.time;
  const parsedTime = Date.parse(t);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(t) ||
      !Number.isFinite(parsedTime) || new Date(parsedTime).toISOString().slice(0, 19) !== t.slice(0, 19))
    return report('INVALID_TIME');
  if (parsedTime < nowMs - 120000 || parsedTime > nowMs + 15000)
    return report('STALE_SNAPSHOT');
  if (snapshot.resources.some(x => !rec(x) || typeof x.resource_id !== 'string' ||
      x.resource_id.length < 1 || x.resource_id.length > 256 ||
      !(typeof x.employee_id === 'string' || x.employee_id === null)))
    return report('INVALID_RESOURCE');
  if (snapshot.sharedLeases.some(x => !rec(x) || typeof x.resource_id !== 'string' ||
      x.resource_id.length < 1 || x.resource_id.length > 256))
    return report('INVALID_LEASE_PROJECTION');
  if (snapshot.jobs.some(x => !rec(x) || !['running', 'queued'].includes(x.status) ||
      !(x.resource_id === null || typeof x.resource_id === 'string') ||
      !(x.employee_id === null || typeof x.employee_id === 'string')))
    return report('INVALID_JOB_PROJECTION');
  const ownedRows = snapshot.resources.filter(x => x.employee_id === 'NV02');
  const counts = { resources: snapshot.resources.length, nv02Rows: ownedRows.length,
    sharedLeases: snapshot.sharedLeases.length };
  if (!ownedRows.length) return report('NV02_RESOURCE_ABSENT', counts);
  const inUse = new Set(snapshot.sharedLeases.map(x => x.resource_id));
  const runningJobs = new Set(snapshot.jobs.filter(x => x.status === 'running' &&
    typeof x.resource_id === 'string').map(x => x.resource_id));
  const busy = ownedRows.filter(x => inUse.has(x.resource_id) || runningJobs.has(x.resource_id) ||
    (typeof x.current_job_id === 'string' && x.current_job_id.length > 0) ||
    (typeof x.shared_lease_work_id === 'string' && x.shared_lease_work_id.length > 0));
  if (busy.length === ownedRows.length) return report('NV02_RESOURCE_BUSY',
    { ...counts, busyRows: busy.length });
  // Visible resource is NOT proof of user identity, action authorization or
  // transactional claim; only an actual Core-issued receipt could prove that.
  return report('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED', counts);
}
async function cli() {
  if (process.argv.length !== 3 || process.argv[2] !== '--read-only')
    return { code: 2, result: report('READ_ONLY_FLAG_REQUIRED') };
  let raw = '';
  process.stdin.setEncoding('utf8');
  try {
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > 262144)
        return { code: 2, result: report('INPUT_TOO_LARGE') };
    }
    const result = inspectR05ReadOnly(JSON.parse(raw));
    const malformed = result.decision.startsWith('INVALID_') || result.decision === 'OVERSIZED_SNAPSHOT';
    return { code: malformed ? 2 : 0, result };
  } catch {
    return { code: 2, result: report('INPUT_INVALID_OR_UNREADABLE') };
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { code, result } = await cli();
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = code;
}
