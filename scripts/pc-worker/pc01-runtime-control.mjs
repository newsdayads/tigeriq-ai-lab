import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CONTROLLER_URL = 'http://127.0.0.1:8798';
export const DEFAULT_LOG_PATH = 'D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\chrome-controller.jsonl';
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const WORKER_ACTIONS = new Set(['start', 'focus', 'layout', 'close', 'unblock', 'enable', 'disable']);
const GLOBAL_ACTIONS = new Map([
  ['start-all', '/api/start-all'],
  ['pause', '/api/pause'],
  ['resume', '/api/resume'],
]);

export function assertLoopbackBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error('RUNTIME_CONTROL_LOOPBACK_ONLY');
  return url.origin;
}

export async function requestJson(path, { baseUrl = DEFAULT_CONTROLLER_URL, method = 'GET', payload, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const origin = assertLoopbackBaseUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}${path}`, {
      method,
      headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`RUNTIME_CONTROL_HTTP_${response.status}:${JSON.stringify(data)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function tailJsonl(logPath = DEFAULT_LOG_PATH, limit = 20) {
  const bounded = Math.max(0, Math.min(50, Number(limit) || 0));
  if (!bounded) return [];
  try {
    const text = await readFile(logPath, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-bounded).map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
  } catch (error) {
    return [{ event: 'LOG_UNAVAILABLE', error: String(error) }];
  }
}

export async function collectSnapshot({ baseUrl = DEFAULT_CONTROLLER_URL, logPath = DEFAULT_LOG_PATH, logTail = 20, fetchImpl = fetch } = {}) {
  const started = performance.now();
  const [state, recentEvents] = await Promise.all([
    requestJson('/api/state', { baseUrl, fetchImpl }),
    tailJsonl(logPath, logTail),
  ]);
  return {
    ok: true,
    capturedAt: new Date().toISOString(),
    elapsedMs: Math.round((performance.now() - started) * 10) / 10,
    state,
    recentEvents,
  };
}

export function resolveActionPath(action, workerId) {
  if (GLOBAL_ACTIONS.has(action)) return GLOBAL_ACTIONS.get(action);
  if (!/^NV0[345]$/.test(workerId ?? '') || !WORKER_ACTIONS.has(action)) throw new Error('RUNTIME_CONTROL_ACTION_NOT_ALLOWED');
  return `/api/workers/${workerId}/${action}`;
}

export async function runAction(action, workerId, options = {}) {
  const path = resolveActionPath(action, workerId);
  return requestJson(path, { ...options, method: 'POST' });
}

async function main(argv) {
  const [mode = 'snapshot', arg1, arg2] = argv;
  if (mode === 'snapshot') {
    const result = await collectSnapshot({ logTail: arg1 ? Number(arg1) : 20 });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === 'action') {
    const result = await runAction(String(arg1 ?? ''), arg2);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error('USAGE: node pc01-runtime-control.mjs snapshot [logTail] | action <action> [NV03|NV04|NV05]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
