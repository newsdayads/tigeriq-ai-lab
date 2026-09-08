import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startOwnerCockpitV17 } from '../apps/dashboard/src/server-v17.js';
import type { ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';
import type { ServerTelemetry } from '../apps/dashboard/src/server.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()?.(); });

async function stub(body: string, contentType: string) {
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': contentType }); res.end(body); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  closers.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${address.port}`;
}

const telemetry: ServerTelemetry = { available: true, server: 'PC01', generatedAt: '2026-09-08T06:45:00.000Z', cpu: null, memory: null, uptimeSeconds: 1, disk: null, worker: null, controller: { online: true, ip: '100.97.23.87', port: 8790, protocol: 'controller-v1' }, workforce: null, postgresql: null, ollama: null, tailscale: null, gpu: null };
const data: ExecutiveDashboardV4 = { generatedAt: '2026-09-08T06:45:00.000Z', works: [{ number: 508, title: 'Live foundation', ownerCode: 'NV01', owner: 'Minh (NV01)', progressPercent: null, progressLabel: '—', status: 'Chờ xử lý', tone: 'waiting', next: 'SSE', updated: '08/09/2026 13:45:00' }], people: [], systems: [{ key: 'control', name: 'Bộ điều phối', status: 'Hoạt động', tone: 'active', note: 'controller-v1' }], activeCount: 0, waitingCount: 1, blockedCount: 0, doneCount: 0, pausedCount: 0, progressAverage: null, ownerActionRequired: false, ownerActionText: 'Không có việc cần anh Sơn' };
describe('Web Control V5 SSE foundation', () => {
  it('serves authenticated typed events without full-page polling as the primary channel', async () => {
    const stableUrl = await stub('<!doctype html><html><body>ok</body></html>', 'text/html; charset=utf-8');
    const backendUrl = await stub(JSON.stringify(telemetry), 'application/json; charset=utf-8');
    const outer = await startOwnerCockpitV17({ stableUrl, backendUrl, repo: 'newsdayads/tigeriq-ai-lab', loadData: async () => data, livePollMs: 1000 });
    closers.push(outer.close);

    const abort = new AbortController();
    const response = await fetch(`${outer.url}/api/events`, { signal: abort.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    abort.abort();

    expect(text).toContain('event: tigeriq');
    expect(text).toContain('work.queued');
    expect(text).toContain('evt-');
    expect(text).not.toContain('authorization');
    expect(text).not.toContain('secret');
  });

  it('serves a prewarmed V5 overview without waiting on the stable relay', async () => {
    const slow = createServer((_req, res) => { setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<html>slow</html>'); }, 2000); });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    const slowAddress = slow.address() as AddressInfo;
    closers.push(() => new Promise<void>((resolve, reject) => slow.close((error) => error ? reject(error) : resolve())));
    const backendUrl = await stub(JSON.stringify(telemetry), 'application/json; charset=utf-8');
    let loads = 0;
    const outer = await startOwnerCockpitV17({ stableUrl: `http://127.0.0.1:${slowAddress.port}`, backendUrl, repo: 'newsdayads/tigeriq-ai-lab', loadData: async () => { loads += 1; return data; } });
    closers.push(outer.close);
    const started = Date.now();
    const response = await fetch(`${outer.url}/`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(loads).toBe(1);
    expect(html).toContain('Web Control V5');
    expect(html).toContain('V5 · LIVE SSE');
  });
});
