export const HEALTH_STATES = {
  IDLE_ON_DEMAND: 'IDLE_ON_DEMAND',
  BUSY: 'BUSY',
  ERROR: 'ERROR'
};

export const NV09_EMPLOYEE_ID = 'NV09';
export const NV09_MODEL = 'qwen3-coder:30b';
export const NV09_ENDPOINT = 'http://127.0.0.1:11434';

const registeredModels = new Map();

export function registerNv09() {
  const existing = registeredModels.get(NV09_EMPLOYEE_ID);
  if (existing) return existing;
  const config = {
    employee_id: NV09_EMPLOYEE_ID,
    model: NV09_MODEL,
    endpoint: NV09_ENDPOINT,
    capability: ['coding','review'],
    health: HEALTH_STATES.IDLE_ON_DEMAND
  };
  registeredModels.set(NV09_EMPLOYEE_ID, config);
  return config;
}

export function getRegisteredModels() {
  return Array.from(registeredModels.values()).map(x => ({ ...x }));
}

export function setModelHealth(employeeId, healthState) {
  const entry = registeredModels.get(employeeId);
  if (entry) entry.health = healthState;
}

export async function nv09ModelAvailability(fetchImpl = fetch) {
  const entry = registeredModels.get(NV09_EMPLOYEE_ID) || registerNv09();
  const started = Date.now();
  try {
    const res = await fetchImpl(`${entry.endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { ok: false, reason: `OLLAMA_TAGS_HTTP_${res.status}`, latencyMs: Date.now() - started };
    }
    const body = await res.json();
    const models = Array.isArray(body?.models) ? body.models : [];
    const model = models.find(x => String(x?.name || x?.model || '') === entry.model);
    if (!model) {
      return { ok: false, reason: 'NV09_MODEL_NOT_PRESENT', latencyMs: Date.now() - started };
    }
    return {
      ok: true,
      employeeId: NV09_EMPLOYEE_ID,
      model: entry.model,
      digest: String(model?.digest || ''),
      size: Number(model?.size || 0),
      latencyMs: Date.now() - started
    };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error), latencyMs: Date.now() - started };
  }
}

export async function runBoundedInferenceNv09(prompt, options = {}) {
  const opts = typeof options === 'number' ? { timeoutMs: options } : (options || {});
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 120000));
  const keepAlive = String(opts.keepAlive || '30s');
  const numCtx = Math.max(256, Math.min(4096, Number(opts.numCtx || 1024)));
  const numPredict = Math.max(1, Math.min(256, Number(opts.numPredict || 96)));
  const fetchImpl = opts.fetchImpl || fetch;
  const entry = registeredModels.get(NV09_EMPLOYEE_ID) || registerNv09();
  setModelHealth(NV09_EMPLOYEE_ID, HEALTH_STATES.BUSY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${entry.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: entry.model,
        prompt: String(prompt || '').slice(0, 4000),
        stream: false,
        keep_alive: keepAlive,
        think: false,
        options: { temperature: 0, num_ctx: numCtx, num_predict: numPredict }
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      let detail = '';
      try {
        const raw = await res.text();
        if (raw) {
          try { detail = String(JSON.parse(raw)?.error || raw); }
          catch { detail = raw; }
        }
      } catch {}
      const error = new Error(`NV09_INFERENCE_HTTP_${res.status}${detail ? `:${detail.slice(0, 500)}` : ''}`);
      error.kind = res.status >= 500 ? 'outage' : 'configuration';
      throw error;
    }
    const json = await res.json();
    const text = String(json?.response || json?.text || '').trim();
    if (!text) {
      const error = new Error('NV09_INFERENCE_EMPTY');
      error.kind = 'invalid_response';
      throw error;
    }
    setModelHealth(NV09_EMPLOYEE_ID, HEALTH_STATES.IDLE_ON_DEMAND);
    return {
      text,
      model: String(json?.model || entry.model),
      done: json?.done !== false,
      loadDurationNs: Number(json?.load_duration || 0),
      evalDurationNs: Number(json?.eval_duration || 0),
      evalCount: Number(json?.eval_count || 0)
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      setModelHealth(NV09_EMPLOYEE_ID, HEALTH_STATES.IDLE_ON_DEMAND);
      const timeout = new Error(`NV09_INFERENCE_TIMEOUT_${timeoutMs}MS`);
      timeout.kind = 'timeout';
      throw timeout;
    }
    setModelHealth(NV09_EMPLOYEE_ID, HEALTH_STATES.ERROR);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

registerNv09();
