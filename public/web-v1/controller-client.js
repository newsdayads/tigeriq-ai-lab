export const WEB_SNAPSHOT_SCHEMA = 'tigeriq.web-control.snapshot.v1';
export const WEB_GOAL_SCHEMA = 'tigeriq.web-control.goal.v1';
export const CONTROLLER_ENDPOINTS = Object.freeze({
  health: '/api/workforce/status',
  snapshot: '/api/web/v1/snapshot',
  goals: '/api/web/v1/goals',
  promptVersions: '/api/web/v1/prompts/versions',
  jobRetry: (jobId) => `/api/web/v1/jobs/${encodeURIComponent(jobId)}/retry`,
});

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isCgnatIp(hostname) {
  const parts = String(hostname || '').split('.').map(Number);
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function controllerUrlPolicy(value, pageProtocol = globalThis.location?.protocol || 'https:') {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, code: 'CONTROLLER_URL_REQUIRED' };
  let url;
  try { url = new URL(raw); } catch { return { ok: false, code: 'CONTROLLER_URL_INVALID' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, code: 'CONTROLLER_PROTOCOL_INVALID' };
  const host = url.hostname.toLowerCase();
  const tailnetHost = host.endsWith('.ts.net') || isCgnatIp(host) || host === 'localhost' || host === '127.0.0.1' || (!host.includes('.') && host.length > 0);
  if (!tailnetHost) return { ok: false, code: 'CONTROLLER_NOT_TAILNET_OR_LOCAL' };
  if (pageProtocol === 'https:' && url.protocol !== 'https:') {
    return { ok: false, code: 'CONTROLLER_MIXED_CONTENT', hint: 'Use Tailscale HTTPS/MagicDNS or serve Web locally over HTTP.' };
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return { ok: true, baseUrl: url.toString().replace(/\/$/, '') };
}

export function validateControllerSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('CONTROLLER_SNAPSHOT_INVALID');
  if (snapshot.schemaVersion !== WEB_SNAPSHOT_SCHEMA) throw new Error('CONTROLLER_SCHEMA_MISMATCH');
  if (snapshot.source?.mode !== 'controller' || snapshot.source?.authoritative !== true) throw new Error('CONTROLLER_SNAPSHOT_NOT_AUTHORITATIVE');
  if (!Number.isFinite(Date.parse(String(snapshot.generatedAt || '')))) throw new Error('CONTROLLER_SNAPSHOT_TIME_INVALID');
  for (const key of ['jobs', 'employees', 'devices', 'providers', 'prompts', 'results', 'activity']) {
    if (!Array.isArray(snapshot[key])) throw new Error(`CONTROLLER_SNAPSHOT_${key.toUpperCase()}_INVALID`);
  }
  return snapshot;
}

export class WorkforceControllerClient {
  constructor({ baseUrl, accessToken = '', fetchImpl = globalThis.fetch, pageProtocol } = {}) {
    const policy = controllerUrlPolicy(baseUrl, pageProtocol);
    if (!policy.ok) {
      const error = new Error(policy.code);
      error.hint = policy.hint;
      throw error;
    }
    if (typeof fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');
    this.baseUrl = policy.baseUrl;
    this.accessToken = String(accessToken || '').trim();
    this.fetchImpl = fetchImpl;
  }

  async request(path, { method = 'GET', body, signal } = {}) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    // Browser Web V1 never sends the Workforce Controller admin secret.
    // A future Controller-issued Owner/browser capability can be supplied as a short-lived bearer.
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'include',
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(payload?.error || `CONTROLLER_HTTP_${response.status}`));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  health(options) {
    return this.request(CONTROLLER_ENDPOINTS.health, options);
  }

  async snapshot(options) {
    const payload = await this.request(CONTROLLER_ENDPOINTS.snapshot, options);
    return validateControllerSnapshot(payload);
  }

  submitGoal(goal, options) {
    return this.request(CONTROLLER_ENDPOINTS.goals, {
      ...options,
      method: 'POST',
      body: { schemaVersion: WEB_GOAL_SCHEMA, goal },
    });
  }

  savePromptVersion(promptVersion, options) {
    return this.request(CONTROLLER_ENDPOINTS.promptVersions, {
      ...options,
      method: 'POST',
      body: { schemaVersion: WEB_SNAPSHOT_SCHEMA, promptVersion },
    });
  }

  retryJob(jobId, reason = 'owner_request', options) {
    return this.request(CONTROLLER_ENDPOINTS.jobRetry(jobId), {
      ...options,
      method: 'POST',
      body: { reason },
    });
  }
}

export class MockControllerClient {
  constructor(snapshot) {
    this._snapshot = copy(snapshot);
  }
  async health() {
    return { ok: true, mock: true, workforce: this._snapshot?.company?.workforceSummary || null };
  }
  async snapshot() {
    return copy(this._snapshot);
  }
  async submitGoal(goal) {
    return {
      ok: true,
      mock: true,
      dispatched: false,
      draftId: `MOCK-DRAFT-${Date.now()}`,
      goal: copy(goal),
      note: 'Mock mode: nothing was sent to PC01.',
    };
  }
  async savePromptVersion(promptVersion) {
    return { ok: true, mock: true, persisted: false, promptVersion: copy(promptVersion) };
  }
  async retryJob(jobId) {
    return { ok: true, mock: true, retried: false, jobId, note: 'Mock mode: retry was not dispatched.' };
  }
}
