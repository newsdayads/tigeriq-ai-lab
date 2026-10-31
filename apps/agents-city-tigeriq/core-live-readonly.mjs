// TIGERIQ_AGENTS_CITY_LIVE_RUNTIME_V1 — read-only live Core projection.
// Source: PC01 TigerIQ Core /api/status. Never creates jobs, leases or workers.
export const CORE_STATUS_URL = 'http://127.0.0.1:8795/api/status';
export const MAX_STATUS_AGE_MS = 30_000;
const MAX_BODY_BYTES = 4_000_000;
const MAX_RESOURCES = 200;
const MAX_JOBS = 500;
const MAX_LEASES = 500;

const clean = (value, limit = 220) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';

function roomForJob(job = {}, resource = {}) {
  const text = [
    clean(job.capability, 80),
    clean(job.kind, 80),
    clean(job.title, 180),
    clean(resource.shared_lease_role, 80),
    clean(resource.shared_lease_lane, 80),
  ].join(' ').toUpperCase();
  if (/(REVIEW|QA|TEST|VERIFY|QUALITY|ACCEPTANCE)/.test(text)) return 'quality';
  if (/(CODING|CODE|ENGINEER|SOURCE|BUILD|ANDROID|DEPLOY)/.test(text)) return 'engineering';
  return 'coordination';
}

function validArray(value, max) {
  return Array.isArray(value) && value.length <= max;
}

export function normalizeLiveCoreSnapshot(source, {now = Date.now()} = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      source.ok !== true || !source.core || typeof source.core !== 'object' ||
      !validArray(source.resources, MAX_RESOURCES) ||
      !validArray(source.jobs, MAX_JOBS) ||
      !validArray(source.sharedLeases, MAX_LEASES)) {
    throw new Error('CORE_LIVE_UNVERIFIED');
  }

  const coreTimeMs = Date.parse(source.core.time);
  if (!Number.isFinite(coreTimeMs) || coreTimeMs > now + 10_000 ||
      now - coreTimeMs > MAX_STATUS_AGE_MS) {
    throw new Error('CORE_LIVE_STALE');
  }

  const runningJobs = new Map();
  for (const raw of source.jobs) {
    if (!raw || typeof raw !== 'object' || raw.status !== 'running') continue;
    const id = clean(raw.id, 140);
    const employeeId = clean(raw.employee_id, 32).toUpperCase();
    const resourceId = clean(raw.resource_id, 220);
    if (!id || !/^NV\d{2}$/.test(employeeId) || !resourceId) continue;
    const jobLeaseMs = Date.parse(raw.lease_until);
    runningJobs.set(id, {
      id,
      employeeId,
      resourceId,
      title: clean(raw.title, 200) || 'Công việc Core',
      capability: clean(raw.capability, 80),
      kind: clean(raw.kind, 80),
      provider: clean(raw.provider, 80),
      startedAt: clean(raw.started_at, 64),
      jobLeaseUntil:Number.isFinite(jobLeaseMs)&&jobLeaseMs>now?new Date(jobLeaseMs).toISOString():null,
    });
  }

  const leases = new Map();
  for (const raw of source.sharedLeases) {
    if (!raw || typeof raw !== 'object') continue;
    const workId = clean(raw.work_id, 140);
    const resourceId = clean(raw.resource_id, 220);
    const employeeId = clean(raw.employee_id, 32).toUpperCase();
    const untilMs = Date.parse(raw.lease_until);
    if (!workId || !resourceId || !/^NV\d{2}$/.test(employeeId) ||
        !Number.isFinite(untilMs) || untilMs <= now) continue;
    leases.set(resourceId + '|' + workId, {
      role: clean(raw.role, 80),
      lane: clean(raw.lane, 80),
      leaseUntil: new Date(untilMs).toISOString(),
    });
  }

  const workers = [];
  const seen = new Set();
  for (const raw of source.resources) {
    if (!raw || typeof raw !== 'object') continue;
    const employeeId = clean(raw.employee_id, 32).toUpperCase();
    const resourceId = clean(raw.resource_id, 220);
    const currentJobId = clean(raw.current_job_id, 140);
    const status = clean(raw.status, 40).toUpperCase();
    if (!/^NV\d{2}$/.test(employeeId) || !resourceId || !currentJobId || status !== 'BUSY') continue;
    const job = runningJobs.get(currentJobId);
    if (!job || job.employeeId !== employeeId || job.resourceId !== resourceId) continue;
    const key = employeeId + '|' + resourceId + '|' + currentJobId;
    if (seen.has(key)) continue;
    seen.add(key);
    const sharedLease = leases.get(resourceId + '|' + currentJobId) || null;
    const jobLease = !sharedLease && job.jobLeaseUntil ? {
      role:'core-job',lane:'core',leaseUntil:job.jobLeaseUntil
    } : null;
    const lease = sharedLease || jobLease;
    workers.push({
      employeeId,
      resourceId,
      name: clean(raw.name, 100) || employeeId,
      provider: clean(raw.provider, 80) || job.provider,
      model: clean(raw.model, 120),
      currentJobId,
      jobTitle: job.title,
      capability: job.capability,
      kind: job.kind,
      startedAt: job.startedAt,
      room: roomForJob(job, raw),
      activeWorkerVerified: true,
      leaseVerified: Boolean(lease),
      leaseSource: sharedLease ? 'shared' : jobLease ? 'job' : null,
      leaseRole: lease?.role || null,
      leaseLane: lease?.lane || null,
      leaseUntil: lease?.leaseUntil || null,
    });
  }

  workers.sort((a,b) => a.employeeId.localeCompare(b.employeeId) ||
    a.currentJobId.localeCompare(b.currentJobId));

  return {
    ok: true,
    schema: 'tigeriq/agents-city-live@2',
    source: 'TigerIQ Core /api/status',
    verifiedAt: new Date(coreTimeMs).toISOString(),
    liveWorkerBindingsVerified: true,
    workers,
    totalActiveWorkers: workers.length,
  };
}

export async function fetchLiveCoreSnapshot({
  fetchImpl = fetch, now = Date.now(), url = CORE_STATUS_URL, timeoutMs = 5000,
} = {}) {
  if (url !== CORE_STATUS_URL) throw new Error('CORE_LIVE_ORIGIN_NOT_ALLOWED');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15_000)
    throw new Error('INVALID_TIMEOUT');
  const response = await fetchImpl(url, {
    method:'GET', redirect:'error', cache:'no-store',
    headers:{accept:'application/json'},
    signal:AbortSignal.timeout(timeoutMs),
  });
  if (!response || response.ok !== true || response.status !== 200)
    throw new Error('CORE_LIVE_HTTP_UNAVAILABLE');
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Error('CORE_LIVE_BODY_TOO_LARGE');
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('CORE_LIVE_BODY_TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(body); } catch { throw new Error('CORE_LIVE_JSON_INVALID'); }
  return normalizeLiveCoreSnapshot(parsed, {now});
}
