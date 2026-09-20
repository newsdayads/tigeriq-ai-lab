import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

const CORE_PORT = 18895;
const WEB_PORT = 18896;
const CODING_PORT = 18897;
let fakeCore: Server;
let fakeCoding: Server;
let web: ChildProcess;

const statusPayload = {
  ok: true,
  core: { host: '127.0.0.1', port: CORE_PORT, pid: 1234, uptimeSec: 321 },
  integrations: { surfsense: { ok: false } },
  resources: [{
    employee_id: 'NV02', name: 'Ollama', provider: 'ollama', model: 'qwen3:4b', status: 'IDLE',
    calls_success_24h: 11, calls_failure_24h: 1, last_latency_ms: 210, last_seen_at: new Date().toISOString()
  }],
  objectives: [{ id: 'OBJ-1', objective: 'Core Test', priority: 'P1', status: 'active', manager_cycles: 7, updated_at: new Date().toISOString() }],
  jobs: [{ id: 'JOB-1', title: 'Core read-only test', status: 'done', employee_id: 'NV02', completed_at: new Date().toISOString() }],
  events: [{ type: 'RESOURCE_PROBE_OK', employee_id: 'NV02', ts: new Date().toISOString() }],
  telemetry: [{ employee_id: 'NV02', latency_ms: 180, ts: new Date(Date.now() - 1000).toISOString() }, { employee_id: 'NV02', latency_ms: 220, ts: new Date().toISOString() }]
};

const codingPayload = {
  ok: true,
  service: 'tigeriq-coding-lane',
  pid: 5678,
  resources: [{ id: 'NV12', provider: 'gemini', model: 'test' }],
  objectives: [{ id: 'CODEOBJ-1', objective: 'Coding Test', priority: 'P0', status: 'active', manager_employee_id: 'NV11', updated_at: new Date().toISOString() }],
  jobs: [{ id: 'CODE-1', objective_id: 'CODEOBJ-1', title: 'Fix Web Control', status: 'review', employee_id: 'NV12', reviewer_employee_id: 'NV19' }]
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
  it('serves the unified owner dashboard with Health parity assets', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.text();
    expect(body).toContain('<title>TigerIQ Core 24/7 — Web Control</title>');
    expect(body).toContain('<link rel="stylesheet" href="/web-control-unified.css">');
    expect(body).toContain('<link rel="stylesheet" href="/web-control-mobile.css">');
    expect(body).toContain('<script src="/web-control-truth.js"></script>');
    expect(body).toContain('<script src="/web-control-unified.js"></script>');
    expect(body).not.toMatch(/<iframe\b/i);

    const [truth, unified, css, mobile] = await Promise.all([
      fetch(`http://127.0.0.1:${WEB_PORT}/web-control-truth.js`),
      fetch(`http://127.0.0.1:${WEB_PORT}/web-control-unified.js`),
      fetch(`http://127.0.0.1:${WEB_PORT}/web-control-unified.css`),
      fetch(`http://127.0.0.1:${WEB_PORT}/web-control-mobile.css`)
    ]);
    expect(truth.status).toBe(200); expect(unified.status).toBe(200); expect(css.status).toBe(200); expect(mobile.status).toBe(200);
    const truthJs = await truth.text(); const unifiedJs = await unified.text(); const unifiedStyle = await css.text(); const mobileStyle = await mobile.text();
    expect(truthJs).toContain('Không bịa %');
    expect(truthJs).toContain("['Review'");
    expect(truthJs).toContain('reviewer_employee_id');
    expect(unifiedJs).toContain('Hiệu suất API');
    expect(unifiedJs).toContain('Công việc gần nhất');
    expect(unifiedJs).toContain('telemetry');
    expect(unifiedJs).toContain('LIVE · 2s');
    expect(unifiedStyle).toContain('"Segoe UI",Roboto,Helvetica,Arial,sans-serif');
    expect(unifiedStyle).toContain('content:"TigerIQ AI"');
    expect(unifiedStyle).toContain('.topbar>.title,.topbar>.system-pill,.topbar>.clock{display:none!important}');
    expect(unifiedStyle).toContain('"SFMono-Regular",Consolas,"Roboto Mono","Liberation Mono",Menlo,monospace');
    expect(mobileStyle).toContain('overflow-x:hidden');
  });

  it('aggregates live Core, telemetry and Coding Lane status read-only', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/api/status`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(body.core).toEqual(statusPayload.core);
    expect(body.telemetry).toEqual(statusPayload.telemetry);
    expect(body.resources[0].last_latency_ms).toBe(210);
    expect(body.codingLane).toEqual(codingPayload);
  });

  it('reports combined health without mutating Core', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/health`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(body.service).toBe('tigeriq-web-control');
    expect(body.core.ok).toBe(true);
    expect(body.coding.ok).toBe(true);
  });

  it('rejects mutation methods', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/api/status`, { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('verifies corrected endpoints, live-refresh channels and responsive layouts in client assets', async () => {
    const truthRes = await fetch(`http://127.0.0.1:${WEB_PORT}/web-control-truth.js`);
    const truthText = await truthRes.text();
    expect(truthText).toContain('TIGERIQ_CONFIG');

    const htmlRes = await fetch(`http://127.0.0.1:${WEB_PORT}/`);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('TIGERIQ_CONFIG');
    expect(htmlText).toContain('statusUrl');
    expect(htmlText).toContain('healthUrl');
  });
});
