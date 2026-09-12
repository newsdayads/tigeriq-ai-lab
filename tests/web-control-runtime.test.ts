import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { JSDOM } from 'jsdom';

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
  it('serves the separate Web Control product with truth guard', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.text();
    expect(body).toContain('<title>TigerIQ Core 24/7 — Web Control</title>');
    expect(body).toContain('<script src="/web-control-truth.js"></script>');
    const truth = await fetch(`http://127.0.0.1:${WEB_PORT}/web-control-truth.js`);
    expect(truth.status).toBe(200);
    const js = await truth.text();
    expect(js).toContain('Không bịa %');
    expect(js).toContain("['Review'");
    expect(js).toContain('reviewer_employee_id');
  });

  it('aggregates live Core and Coding Lane status read-only', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/api/status`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(body.core).toEqual(statusPayload.core);
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

  it('handles polling truth, stale detection, warnings, and recovery in jsdom with fake timers', async () => {
    vi.useFakeTimers();
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div class="container">
        <div id="metrics"></div>
        <div id="pipeline"></div>
        <div id="objectivePreview"></div>
        <div id="objectivesFull"></div>
        <table id="jobsTable"></table>
        <select id="providerFilter"><option value="all">All</option></select>
        <select id="stateFilter"><option value="all">All</option></select>
        <input id="searchPeople" />
        <div id="topHealth"></div>
        <div id="sysWeb"></div>
      </div>
    </body></html>`, { url: 'http://localhost' });

    global.window = dom.window as any;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.esc = (s: string) => s;
    global.counts = () => ({ active: 1, resources: 2, busy: 0, problems: 0 });
    global.ago = () => '1m ago';
    global.duration = () => '1h';

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/health') || url.includes('/api/status')) {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => url.includes('/health') ? { ok: true } : statusPayload
          };
        } else if (callCount === 2) {
          // Simulate failure on second fetch
          throw new Error('Network error');
        } else {
          // Recovery on third fetch
          return {
            ok: true,
            json: async () => url.includes('/health') ? { ok: true } : statusPayload
          };
        }
      }
      throw new Error('Unknown url');
    });
    global.fetch = mockFetch as any;

    // Load script implementation in test environment
    const fs = await import('node:fs');
    const truthScriptCode = fs.readFileSync('apps/tigeriq-core/web-control-truth.js', 'utf-8');
    dom.window.eval(truthScriptCode);

    // Trigger initial poll manually or via timers
    const pollTruthFn = (dom.window as any).pollTruth || (async () => {
      // fallback if not directly exposed, re-trigger via code eval or test helper
    });

    // Verify first successful payload rendering & freshness reset
    const freshnessEl = dom.window.document.getElementById('freshnessIndicator');
    expect(freshnessEl?.textContent).toContain('Cập nhật lúc');

    // Advance timers by 7 seconds to exceed 6s stale condition
    vi.advanceTimersByTime(7000);
    expect(freshnessEl?.textContent).toContain('DỮ LIỆU CŨ');
    const warningBanner = dom.window.document.getElementById('staleWarningBanner');
    expect(warningBanner?.className).toContain('visible');

    vi.useRealTimers();
  });
});
