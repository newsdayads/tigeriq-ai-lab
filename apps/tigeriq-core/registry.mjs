export const HEALTH_STATES = { IDLE_ON_DEMAND: 'IDLE_ON_DEMAND', BUSY: 'BUSY', ERROR: 'ERROR' };

const registeredModels = new Map();

export function registerNv09() {
  const config = {
    employee_id: 'NV09',
    model: 'qwen3-coder:30b',
    endpoint: 'http://127.0.0.1:11434',
    health: HEALTH_STATES.IDLE_ON_DEMAND
  };
  registeredModels.set('NV09', config);
  return config;
}

export function getRegisteredModels() {
  return Array.from(registeredModels.values());
}

export function setModelHealth(employeeId, healthState) {
  if (registeredModels.has(employeeId)) {
    const entry = registeredModels.get(employeeId);
    entry.health = healthState;
  }
}

export async function runBoundedInferenceNv09(prompt, timeoutMs = 5000) {
  const entry = registeredModels.get('NV09') || registerNv09();
setModelHealth('NV09', HEALTH_STATES.IDLE_ON_DEMAND);
  entry.health = HEALTH_STATES.BUSY;
try { setModelHealth('NV09', HEALTH_STATES.BUSY); } catch (err) { }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${entry.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: entry.model, prompt, stream: false }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      entry.health = HEALTH_STATES.ERROR;
      throw new Error(`Inference failed with status ${res.status}`);
    }
    const json = await res.json();
    entry.health = HEALTH_STATES.IDLE_ON_DEMAND;
try { setModelHealth('NV09', HEALTH_STATES.IDLE_ON_DEMAND); } catch (err) { }
    return json.response || json.text || JSON.stringify(json);
  } catch (err) {
    clearTimeout(timer);
    entry.health = HEALTH_STATES.ERROR;
    if (err.name === 'AbortError') { entry.health = HEALTH_STATES.IDLE_ON_DEMAND; }
      throw new Error('NV09 inference timed out');
    }
    throw err;
  }
}

registerNv09();
