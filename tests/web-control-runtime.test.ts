import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

const CORE_PORT = 18895;
const WEB_PORT = 18896;
let fakeCore: Server;
let web: ChildProcess;

const statusPayload = {
  ok: true,
  core: { host: '127.0.0.1', port: CORE_PORT, pid: 1234, uptimeSec: 321 },
  integrations: { surfsense: { ok: false } },
  resources: [{ employee_id: 'NV02', name: 'Ollama', provider: 'ollama', status: 'IDLE', calls_success_24h: 1, calls_failure_24h: 0 }],
  objectives: [], jobs: [], events: [], telemetry: []
};

async function waitFor(url: string, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
      last = new Error(`HTTP ${response.status}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw last || new Error('timeout');
}

beforeAll(async () => {
  fakeCore = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, pid: 1234, uptimeSec: 321 }));
    }
    if (req.url === '/api/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(statusPayload));
    }
    res.writeHead(404); res.end('not_found');
  });
  await new Promise<void>((resolve, reject) => {
    fakeCore.once('error', reject);
    fakeCore.listen(CORE_PORT, '127.0.0.1', () => resolve());
  });

  web = spawn(process.execPath, ['apps/tigeriq-core/web-control-server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TIGERIQ_WEB_CONTROL_HOST: '127.0.0.1',
      TIGERIQ_WEB_CONTROL_PORT: String(WEB_PORT),
      TIGERIQ_CORE_URL: `http://127.0.0.1:${CORE_PORT}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitFor(`http://127.0.0.1:${WEB_PORT}/health`);
}, 12000);

afterAll(async () => {
  web?.kill('SIGTERM');
  await new Promise<void>(resolve => fakeCore?.close(() => resolve()));
});

describe('Web Control runtime', () => {
  it('serves the separate Web Control product', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).toContain('<title>TigerIQ Core 24/7 — Web Control</title>');
  });

  it('proxies live Core status read-only', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/api/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(statusPayload);
  });

  it('reports combined health without mutating Core', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/health`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(body.service).toBe('tigeriq-web-control');
    expect(body.core.ok).toBe(true);
  });

  it('rejects mutation methods', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/api/status`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});
