import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';

const CORE_PORT = 18895;
const WEB_PORT = 18896;
const CODING_PORT = 18897;
let fakeCore: Server;
let fakeCoding: Server;
let web: ChildProcess;
let failCore = false;

const statusPayload = {
  ok: true,
  core: { host: '127.0.0.1', port: CORE_PORT, pid: 1234, uptimeSec: 321 },
  integrations: { surfsense: { ok: false } },
  resources: [{ employee_id: 'NV02', name: 'Ollama', provider: 'ollama', status: 'IDLE', calls_success_24h: 1, calls_failure_24h: 0 }],
  objectives: [{ id: 'OBJ-1', objective: 'Core Test', priority: 'P1', status: 'active', manager_cycles: 7, updated_at: new Date().toISOString() }],
  jobs: [], events: [], telemetry: []
};

const codingPayload = {
  ok: true,
  service: 'tigeriq-coding-lane',
  pid: 5678,
  resources: [{ id: 'NV12', provider: 'gemini', model: 'test' }],
  objectives: [{ id: 'CODEOBJ-1', objective: 'Coding Test', priority: 'P0', status: 'active', manager_employee_id: 'NV11', updated_at: new Date().toISOString() }],
  jobs: [{ id: 'CODE-1', objective_id: 'CODEOBJ-1', title: 'Fix Web Control', status: 'review', employee_id: 'NV12', reviewer_employee_id: 'NV19' }]
};

async function httpGet(url: string): Promise<{ status: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    request(url, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: data }));
    }).on('error', reject).end();
  });
}

async function waitFor(url: string, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const res = await httpGet(url);
      if (res.status < 500) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw last || new Error('timeout');
}

beforeAll(async () => {
  fakeCore = createServer((req, res) => {
    if (failCore) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false }));
    }
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
  fakeCoding = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, service: 'tigeriq-coding-lane', pid: 5678, resources: 1 }));
    }
    if (req.url === '/api/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(codingPayload));
    }
    res.writeHead(404); res.end('not_found');
  });
  await Promise.all([
    new Promise<void>((resolve, reject) => { fakeCore.once('error', reject); fakeCore.listen(CORE_PORT, '127.0.0.1', resolve); }),
    new Promise<void>((resolve, reject) => { fakeCoding.once('error', reject); fakeCoding.listen(CODING_PORT, '127.0.0.1', resolve); })
  ]);

  web = spawn(process.execPath, ['apps/tigeriq-core/web-control-server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TIGERIQ_WEB_CONTROL_HOST: '127.0.0.1',
      TIGERIQ_WEB_CONTROL_PORT: String(WEB_PORT),
      TIGERIQ_CORE_URL: `http://127.0.0.1:${CORE_PORT}`,
      TIGERIQ_CODING_LANE_URL: `http://127.0.0.1:${CODING_PORT}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitFor(`http://127.0.0.1:${WEB_PORT}/health`);
}, 12000);

afterAll(async () => {
  web?.kill('SIGTERM');
  await Promise.all([
    new Promise<void>(resolve => fakeCore?.close(() => resolve())),
    new Promise<void>(resolve => fakeCoding?.close(() => resolve()))
  ]);
});

describe('Web Control runtime', () => {
  it('serves the separate Web Control product with truth guard', async () => {
    const response = await httpGet(`http://127.0.0.1:${WEB_PORT}/`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    const body = response.body;
    expect(body).toContain('<title>TigerIQ Core 24/7 — Web Control</title>');
    expect(body).toContain('<script src="/web-control-truth.js"></script>');
    const truth = await httpGet(`http://127.0.0.1:${WEB_PORT}/web-control-truth.js`);
    expect(truth.status).toBe(200);
    const js = truth.body;
    expect(js).toContain('Không bịa %');
    expect(js).toContain("['Review'");
    expect(js).toContain('reviewer_employee_id');
  });

  it('aggregates live Core and Coding Lane status read-only', async () => {
    const response = await httpGet(`http://127.0.0.1:${WEB_PORT}/api/status`);
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as any;
    expect(body.ok).toBe(true);
    expect(body.core).toEqual(statusPayload.core);
    expect(body.codingLane).toEqual(codingPayload);
  });

  it('reports combined health without mutating Core', async () => {
    const response = await httpGet(`http://127.0.0.1:${WEB_PORT}/health`);
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as any;
    expect(body.online).toBe(true);
    expect(body.timestamp).toBeTypeOf('string');
  });

  it('returns freshness field with stale boolean and handles failures and recovery', async () => {
    // Check initial freshness
    let res = await httpGet(`http://127.0.0.1:${WEB_PORT}/api/status`);
    expect(res.status).toBe(200);
    let body = JSON.parse(res.body) as any;
    expect(body.freshness).toBeDefined();
    expect(body.freshness.stale).toBe(false);
    expect(body.freshness.lastUpdate).toBeTypeOf('string');

    // Simulate delay > 6 seconds for staleness
    await new Promise(resolve => setTimeout(resolve, 6200));
    res = await httpGet(`http://127.0.0.1:${WEB_PORT}/api/status`);
    body = JSON.parse(res.body) as any;
    expect(body.freshness.stale).toBe(true);

    // Mock underlying truth fetch failure
    failCore = true;
    // Wait for background poll or trigger status to attempt update
    await new Promise(resolve => setTimeout(resolve, 1500));
    res = await httpGet(`http://127.0.0.1:${WEB_PORT}/api/status`);
    body = JSON.parse(res.body) as any;
    expect(body.ok).toBe(true); // serves last-known payload
    expect(body.warning).toBeDefined();
    expect(body.freshness.stale).toBe(true);

    // Recover mock failure
    failCore = false;
    await new Promise(resolve => setTimeout(resolve, 1500));
    res = await httpGet(`http://127.0.0.1:${WEB_PORT}/api/status`);
    body = JSON.parse(res.body) as any;
    expect(body.warning).toBeUndefined();
    expect(body.freshness.stale).toBe(false);
  }, 20000);

  it('rejects mutation methods', async () => {
    return new Promise<void>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${WEB_PORT}/api/status`, { method: 'POST' }, (res) => {
        expect(res.statusCode).toBe(404);
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  });
});
