import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlPlane } from '../packages/control-plane/src/index.js';
import { startDashboard, type ServerTelemetry } from '../apps/dashboard/src/server.js';

let closeCurrent: (() => Promise<void>) | undefined;
afterEach(async () => { await closeCurrent?.(); closeCurrent = undefined; });

const telemetry: ServerTelemetry = {
  available: true,
  server: 'PC01',
  generatedAt: '2026-08-29T16:00:00.000Z',
  cpu: { utilizationPercent: 34.2 },
  memory: { usedBytes: 18 * 1024 ** 3, totalBytes: 32 * 1024 ** 3, utilizationPercent: 56.25 },
  uptimeSeconds: 300000,
  disk: { drive: 'F:', freeBytes: 412 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, utilizationPercent: 58.8 },
  worker: { online: true, pid: 15340, instances: 1 },
  ollama: { online: true, models: ['qwen2.5-coder:14b'] },
  tailscale: { online: true, ip: '100.97.23.87' },
  gpu: null,
};

async function login(url: string, secret = 'local-test-secret') {
  const response = await fetch(`${url}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret }),
    redirect: 'manual',
  });
  expect(response.status).toBe(303);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  expect(cookie).toContain('tigeriq_session=');
  const page = await fetch(url, { headers: { cookie: cookie! } });
  const html = await page.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
  expect(csrf).toBeTruthy();
  return { cookie: cookie!, csrf: csrf! };
}

describe('TigerIQ Command Center', () => {
  it('serves responsive owner-facing HTML and machine-readable status from real snapshots with XSS escaping', async () => {
    const plane = new ControlPlane();
    plane.create({ id: 'WO-010', project: 'TigerIQ', goal: 'Command Center <script>alert(1)</script>', scope: ['dashboard'], invariants: ['no production'], acceptanceCriteria: ['visible status'], status: 'draft' }, { id: 'planner', role: 'planner' });
    const server = await startDashboard(plane, { serverTelemetry: async () => telemetry });
    closeCurrent = server.close;

    const statusResponse = await fetch(`${server.url}/api/status`);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get('cache-control')).toBe('no-store');
    expect(statusResponse.headers.get('x-content-type-options')).toBe('nosniff');
    const status = await statusResponse.json() as { workOrders: Array<{ id: string }>; activeWorkOrders: number };
    expect(status.activeWorkOrders).toBe(1);
    expect(status.workOrders[0]?.id).toBe('WO-010');

    const htmlResponse = await fetch(server.url);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await htmlResponse.text();
    expect(html).toContain('TigerIQ Command Center');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('@media(max-width:520px)');
    expect(html).toContain('Command Center &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Chưa kết nối account automation');
    expect(html).toContain('PC01 SERVER');
    expect(html).toContain('qwen2.5-coder:14b');
    expect(html).toContain('100.97.23.87');
    expect(html).toContain('Chưa có telemetry');
  });

  it('serves allowlisted PC01 telemetry through /api/server', async () => {
    const plane = new ControlPlane();
    const server = await startDashboard(plane, { serverTelemetry: async () => telemetry });
    closeCurrent = server.close;
    const response = await fetch(`${server.url}/api/server`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json() as ServerTelemetry;
    expect(body.available).toBe(true);
    expect(body.worker?.pid).toBe(15340);
    expect(body.ollama?.models).toEqual(['qwen2.5-coder:14b']);
    expect(body.tailscale?.ip).toBe('100.97.23.87');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('stderr');
  });

  it('keeps the web healthy when telemetry is unavailable and does not leak raw errors', async () => {
    const plane = new ControlPlane();
    const unavailable: ServerTelemetry = { available: false, server: 'PC01', generatedAt: new Date().toISOString(), cpu: null, memory: null, uptimeSeconds: null, disk: null, worker: null, ollama: null, tailscale: null, gpu: null };
    const server = await startDashboard(plane, { serverTelemetry: async () => unavailable });
    closeCurrent = server.close;
    const api = await fetch(`${server.url}/api/server`);
    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toMatchObject({ available: false, server: 'PC01' });
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('PC01 Server: Chưa có telemetry');
    expect(html).not.toContain('stderr');
    expect(html).not.toContain('stack trace');
  });

  it('escapes telemetry-controlled strings before rendering the mobile panel', async () => {
    const plane = new ControlPlane();
    const malicious = { ...telemetry, ollama: { online: true, models: ['<img src=x onerror=alert(1)>'] }, tailscale: { online: true, ip: '<script>x</script>' } } satisfies ServerTelemetry;
    const server = await startDashboard(plane, { serverTelemetry: async () => malicious });
    closeCurrent = server.close;
    const response = await fetch(server.url);
    const html = await response.text();
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('.server-grid{grid-template-columns:1fr}');
  });

  it('fails closed for write actions when auth is missing', async () => {
    const plane = new ControlPlane();
    const server = await startDashboard(plane, { commandSecret: 'local-test-secret', submitJob: async () => 'https://github.com/newsdayads/tigeriq-ai-lab/issues/999', serverTelemetry: async () => telemetry });
    closeCurrent = server.close;
    const response = await fetch(`${server.url}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ instruction: 'do safe work', priority: 'Bình thường', csrf: 'x', idempotency: '1234567890abcdef' }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('requires CSRF and creates one durable job for idempotent duplicate submissions', async () => {
    const plane = new ControlPlane();
    const submitJob = vi.fn(async () => 'https://github.com/newsdayads/tigeriq-ai-lab/issues/999');
    const server = await startDashboard(plane, { commandSecret: 'local-test-secret', submitJob, serverTelemetry: async () => telemetry });
    closeCurrent = server.close;
    const { cookie, csrf } = await login(server.url);

    const badCsrf = await fetch(`${server.url}/jobs`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual',
      body: new URLSearchParams({ instruction: 'build command center', priority: 'Cao', csrf: 'wrong', idempotency: 'abcdef1234567890' }),
    });
    expect(badCsrf.status).toBe(403);

    const form = new URLSearchParams({ instruction: 'build command center', priority: 'Cao', csrf, idempotency: 'abcdef1234567890' });
    const first = await fetch(`${server.url}/jobs`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form, redirect: 'manual' });
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toContain('submitted=');
    expect(submitJob).toHaveBeenCalledTimes(1);

    const duplicate = await fetch(`${server.url}/jobs`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form, redirect: 'manual' });
    expect(duplicate.status).toBe(303);
    expect(submitJob).toHaveBeenCalledTimes(1);

    const conflict = await fetch(`${server.url}/jobs`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual',
      body: new URLSearchParams({ instruction: 'different work', priority: 'Cao', csrf, idempotency: 'abcdef1234567890' }),
    });
    expect(conflict.status).toBe(409);
  });

  it('validates malformed job input without invoking the durable queue', async () => {
    const plane = new ControlPlane();
    const submitJob = vi.fn(async () => 'https://github.com/newsdayads/tigeriq-ai-lab/issues/999');
    const server = await startDashboard(plane, { commandSecret: 'local-test-secret', submitJob, serverTelemetry: async () => telemetry });
    closeCurrent = server.close;
    const { cookie, csrf } = await login(server.url);
    const response = await fetch(`${server.url}/jobs`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual',
      body: new URLSearchParams({ instruction: 'x', priority: 'INVALID', csrf, idempotency: 'abcdef1234567890' }),
    });
    expect(response.status).toBe(400);
    expect(submitJob).not.toHaveBeenCalled();
  });

  it('rejects wildcard public binding and unknown routes', async () => {
    const plane = new ControlPlane();
    await expect(startDashboard(plane, { host: '0.0.0.0', serverTelemetry: async () => telemetry })).rejects.toThrow('public wildcard bind is forbidden');

    const server = await startDashboard(plane, { serverTelemetry: async () => telemetry });
    closeCurrent = server.close;
    const response = await fetch(`${server.url}/mutate`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });
});
