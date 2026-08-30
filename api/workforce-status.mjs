const FETCH_TIMEOUT_MS = 5000;

const NODE_STATUSES = ['online', 'degraded', 'offline'];
const WORKER_KINDS = ['android', 'api', 'local', 'browser', 'tool', 'simulator'];
const AVAILABILITIES = ['idle', 'busy', 'offline', 'degraded'];
const TASK_STAGES = ['queued', 'assigned', 'running', 'completed', 'failed', 'cancelled'];

function zero(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function boundedRatio(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function countRecord(source, keys) {
  const out = zero(keys);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return out;
  for (const key of keys) out[key] = finiteNonNegative(source[key]);
  return out;
}

function namedCounts(source, limit = 24) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const out = {};
  for (const [key, value] of Object.entries(source).slice(0, limit)) {
    const safeKey = String(key).trim().slice(0, 64);
    if (safeKey) out[safeKey] = finiteNonNegative(value);
  }
  return out;
}

export function sanitizeWorkforceSnapshot(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const nodes = source.nodes && typeof source.nodes === 'object' ? source.nodes : {};
  const employees = source.employees && typeof source.employees === 'object' ? source.employees : {};
  const tasks = source.tasks && typeof source.tasks === 'object' ? source.tasks : {};
  return {
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt.slice(0, 64) : new Date().toISOString(),
    nodes: {
      total: finiteNonNegative(nodes.total),
      byStatus: countRecord(nodes.byStatus, NODE_STATUSES),
      byKind: countRecord(nodes.byKind, WORKER_KINDS),
    },
    employees: {
      total: finiteNonNegative(employees.total),
      byAvailability: countRecord(employees.byAvailability, AVAILABILITIES),
      activeTasks: finiteNonNegative(employees.activeTasks),
      concurrencyCapacity: finiteNonNegative(employees.concurrencyCapacity),
      utilization: boundedRatio(employees.utilization),
      departments: namedCounts(employees.departments),
      providers: namedCounts(employees.providers),
    },
    tasks: {
      total: finiteNonNegative(tasks.total),
      byStage: countRecord(tasks.byStage, TASK_STAGES),
      active: finiteNonNegative(tasks.active),
      terminal: finiteNonNegative(tasks.terminal),
      failed: finiteNonNegative(tasks.failed),
    },
  };
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
}

function configuredTarget() {
  const raw = String(process.env.TIGERIQ_WORKFORCE_STATUS_URL || '').trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('workforce_status_url_must_use_https');
  if (url.username || url.password) throw new Error('workforce_status_url_must_not_embed_credentials');
  return url;
}

export async function fetchWorkforceStatus(fetchImpl = fetch) {
  const target = configuredTarget();
  if (!target) {
    return {
      ok: true,
      connected: false,
      authority: 'PC01/Farm Controller',
      mode: 'not-configured',
      generatedAt: new Date().toISOString(),
      workforce: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = { accept: 'application/json' };
    const token = String(process.env.TIGERIQ_WORKFORCE_STATUS_TOKEN || '').trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(target, { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`controller_http_${response.status}`);
    const payload = await response.json();
    if (!payload || payload.ok !== true || !payload.workforce) throw new Error('invalid_controller_status');
    return {
      ok: true,
      connected: true,
      authority: 'PC01/Farm Controller',
      mode: 'read-only-ingress',
      generatedAt: new Date().toISOString(),
      workforce: sanitizeWorkforceSnapshot(payload.workforce),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  try {
    return json(res, 200, await fetchWorkforceStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'workforce_status_unavailable';
    return json(res, 200, {
      ok: true,
      connected: false,
      authority: 'PC01/Farm Controller',
      mode: 'unavailable',
      generatedAt: new Date().toISOString(),
      workforce: null,
      reason: message.slice(0, 96),
    });
  }
}
