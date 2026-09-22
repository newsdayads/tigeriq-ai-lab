const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const CORE_HOSTS = new Set([...LOOPBACK_HOSTS, '100.97.23.87']);
export const DEFAULT_CORE_BASE_URL = 'http://100.97.23.87:8795';
export const DEFAULT_CHROME_BASE_URL = 'http://127.0.0.1:8798';

const WORKER_ACTIONS = new Set(['start', 'focus', 'layout', 'close', 'unblock', 'enable', 'disable']);
const GLOBAL_ACTIONS = new Map([
  ['start-all', '/api/start-all'],
  ['pause', '/api/pause'],
  ['resume', '/api/resume'],
]);
const WORKERS = new Set(['NV02', 'NV03', 'NV04']);
const SENSITIVE_KEY = /(secret|token|password|credential|authorization|cookie|api[-_]?key)/i;
const SECRET_TEXT = /\b(?:gsk_|ghp_|github_pat_|sk-|AIza)[A-Za-z0-9_\-.]{8,}\b/g;

function assertBoundedBaseUrl(value, expectedPort, allowedHosts, hostError) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'http:' || !allowedHosts.has(url.hostname)) {
    throw new Error(hostError);
  }
  if (expectedPort && Number(url.port || 80) !== Number(expectedPort)) {
    throw new Error('TIGERIQ_RUNTIME_PORT_NOT_ALLOWED');
  }
  return url.origin;
}

export function assertLoopbackBaseUrl(value, expectedPort) {
  return assertBoundedBaseUrl(value, expectedPort, LOOPBACK_HOSTS, 'TIGERIQ_RUNTIME_LOOPBACK_ONLY');
}

export function assertCoreBaseUrl(value, expectedPort = 8795) {
  return assertBoundedBaseUrl(value, expectedPort, CORE_HOSTS, 'TIGERIQ_RUNTIME_CORE_HOST_NOT_ALLOWED');
}

export function resolveCoreBaseUrl(value) {
  const configured = String(value || '').trim();
  if (!configured || configured === 'http://127.0.0.1:8795') return DEFAULT_CORE_BASE_URL;
  return configured;
}

export function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item),
    ]));
  }
  if (typeof value === 'string') return value.replace(SECRET_TEXT, '[REDACTED]');
  return value;
}

async function requestJson(path, {
  baseUrl,
  expectedPort,
  method = 'GET',
  payload,
  timeoutMs = 5000,
  fetchImpl = fetch,
  signal,
  allowCoreHost = false,
} = {}) {
  const origin = allowCoreHost
    ? assertCoreBaseUrl(baseUrl, expectedPort)
    : assertLoopbackBaseUrl(baseUrl, expectedPort);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('TIGERIQ_RUNTIME_TIMEOUT')), timeoutMs);
  const abort = () => controller.abort(signal?.reason || new Error('TIGERIQ_RUNTIME_ABORTED'));
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  try {
    const response = await fetchImpl(`${origin}${path}`, {
      method,
      headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 2000) }; }
    if (!response.ok) throw new Error(`TIGERIQ_RUNTIME_HTTP_${response.status}`);
    return redactSensitive(data);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}

function compactCoreStatus(data) {
  const resources = Array.isArray(data?.resources) ? data.resources.slice(0, 32).map((r) => ({
    employeeId: r.employee_id ?? r.id ?? null,
    provider: r.provider ?? null,
    model: r.model ?? null,
    health: r.health_state ?? r.status ?? null,
    work: r.work_state ?? null,
    costTier: r.cost_tier ?? null,
    quotaUsable: r.quota_state?.usable ?? null,
    cooldownUntil: r.cooldown_until ?? r.quota_state?.cooldownUntil ?? null,
  })) : [];
  const objectives = Array.isArray(data?.objectives) ? data.objectives.slice(0, 25).map((o) => ({
    id: o.id ?? null,
    priority: o.priority ?? null,
    status: o.status ?? null,
    summary: o.summary ?? null,
    updatedAt: o.updated_at ?? null,
  })) : [];
  return {
    ok: data?.ok !== false,
    pid: data?.pid ?? null,
    uptimeSec: data?.uptimeSec ?? null,
    resources,
    objectives,
  };
}

function compactChromeState(data) {
  const workers = Array.isArray(data?.workers) ? data.workers.map((w) => ({
    id: w.id,
    enabled: w.enabled !== false,
    status: w.status ?? null,
    windowState: w.windowState ?? null,
    blocked: Boolean(w.blocked),
    manualCloseSuppressed: Boolean(w.manualCloseSuppressed),
    heartbeat: w.lastHeartbeat ? {
      state: w.lastHeartbeat.state ?? null,
      uiBusy: Boolean(w.lastHeartbeat.uiBusy),
      authRequired: Boolean(w.lastHeartbeat.authRequired),
      securityBlock: w.lastHeartbeat.securityBlock ?? null,
      at: w.lastHeartbeat.at ?? null,
    } : null,
  })) : [];
  return {
    paused: Boolean(data?.paused),
    killed: Boolean(data?.killed),
    ownerInteractionMode: data?.ownerInteractionMode ?? null,
    externalWorkAutopilotEnabled: Boolean(data?.externalWorkAutopilotEnabled),
    runtimeProvenance: redactSensitive(data?.runtimeProvenance ?? null),
    workers,
  };
}

export function resolveChromeAction(command, workerId) {
  const action = String(command || '');
  if (GLOBAL_ACTIONS.has(action)) return GLOBAL_ACTIONS.get(action);
  if (!WORKER_ACTIONS.has(action) || !WORKERS.has(String(workerId || ''))) {
    throw new Error('TIGERIQ_RUNTIME_CHROME_ACTION_NOT_ALLOWED');
  }
  return `/api/workers/${workerId}/${action}`;
}

export async function executeRuntimeAction(input, options = {}) {
  const started = Date.now();
  const action = String(input?.action || '');
  const coreBaseUrl = resolveCoreBaseUrl(options.coreBaseUrl);
  const chromeBaseUrl = options.chromeBaseUrl || DEFAULT_CHROME_BASE_URL;
  const common = { fetchImpl: options.fetchImpl, signal: options.signal };

  let target;
  let data;
  if (action === 'core_status') {
    target = 'core';
    data = compactCoreStatus(await requestJson('/api/status', {
      ...common, baseUrl: coreBaseUrl, expectedPort: 8795, timeoutMs: 5000, allowCoreHost: true,
    }));
  } else if (action === 'chrome_snapshot') {
    target = 'chrome-controller';
    data = compactChromeState(await requestJson('/api/state', {
      ...common, baseUrl: chromeBaseUrl, expectedPort: 8798, timeoutMs: 5000,
    }));
  } else if (action === 'chrome_action') {
    target = 'chrome-controller';
    const path = resolveChromeAction(input?.command, input?.workerId);
    data = await requestJson(path, {
      ...common, baseUrl: chromeBaseUrl, expectedPort: 8798, method: 'POST', timeoutMs: 15000,
    });
  } else if (action === 'submit_objective') {
    target = 'core';
    const objective = String(input?.objective || '').trim();
    if (objective.length < 8 || objective.length > 6000) throw new Error('TIGERIQ_RUNTIME_OBJECTIVE_INVALID');
    const priority = ['P0', 'P1', 'P2', 'P3'].includes(String(input?.priority || 'P1'))
      ? String(input?.priority || 'P1')
      : 'P1';
    data = await requestJson('/api/objectives', {
      ...common,
      baseUrl: coreBaseUrl,
      expectedPort: 8795,
      method: 'POST',
      payload: { objective, priority },
      timeoutMs: 10000,
      allowCoreHost: true,
    });
  } else {
    throw new Error('TIGERIQ_RUNTIME_ACTION_NOT_ALLOWED');
  }

  return {
    ok: true,
    action,
    target,
    elapsedMs: Date.now() - started,
    data: redactSensitive(data),
    evidence: {
      transport: 'bounded-http',
      shell: false,
      arbitraryFileAccess: false,
      arbitraryCommandExecution: false,
    },
  };
}
