import { afterEach, describe, expect, it } from 'vitest';
import { ControlPlane } from '../packages/control-plane/src/index.js';
import { startDashboard } from '../apps/dashboard/src/server.js';

let closeCurrent: (() => Promise<void>) | undefined;
afterEach(async () => { await closeCurrent?.(); closeCurrent = undefined; });

describe('control center server', () => {
  it('serves owner-facing HTML and machine-readable status from real control-plane snapshots', async () => {
    const plane = new ControlPlane();
    plane.create({ id: 'WO-003', project: 'TigerIQ', goal: 'Control Center <script>alert(1)</script>', scope: ['dashboard'], invariants: ['no production'], acceptanceCriteria: ['visible status'], status: 'draft' }, { id: 'planner', role: 'planner' });
    const server = await startDashboard(plane);
    closeCurrent = server.close;

    const statusResponse = await fetch(`${server.url}/api/status`);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get('cache-control')).toBe('no-store');
    expect(statusResponse.headers.get('x-content-type-options')).toBe('nosniff');
    const status = await statusResponse.json() as { workOrders: Array<{ id: string }>; activeWorkOrders: number };
    expect(status.activeWorkOrders).toBe(1);
    expect(status.workOrders[0]?.id).toBe('WO-003');

    const htmlResponse = await fetch(server.url);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await htmlResponse.text();
    expect(html).toContain('TigerIQ Control Center');
    expect(html).toContain('WO-003');
    expect(html).toContain('Control Center &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('tự làm mới mỗi 15 giây');
  });

  it('fails closed for unknown routes', async () => {
    const plane = new ControlPlane();
    const server = await startDashboard(plane);
    closeCurrent = server.close;
    const response = await fetch(`${server.url}/mutate`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });
});
