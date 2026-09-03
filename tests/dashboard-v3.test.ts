import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlPlane } from '../packages/control-plane/src/index.js';
import { startDashboard, type ServerTelemetry } from '../apps/dashboard/src/server.js';
import { startOwnerCockpitV3 } from '../apps/dashboard/src/server-v3.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

const telemetry: ServerTelemetry = {
  available: true,
  server: 'PC01',
  generatedAt: '2026-09-03T14:00:00.000Z',
  cpu: { utilizationPercent: 18 },
  memory: { usedBytes: 20 * 1024 ** 3, totalBytes: 64 * 1024 ** 3, utilizationPercent: 31 },
  uptimeSeconds: 444000,
  disk: { drive: 'F:', freeBytes: 681 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, utilizationPercent: 32 },
  worker: { online: true, pid: 45628, instances: 1 },
  controller: { online: true, ip: '100.97.23.87', port: 8790 },
  workforce: {
    employeesTotal: 3,
    idle: 1,
    busy: 2,
    offline: 0,
    degraded: 0,
    activeTasks: 2,
    tasksActive: 2,
    tasksFailed: 0,
    roster: [
      { employeeId: 'coder-01', displayName: 'Coder AI', department: 'Engineering', role: 'Code & Script', nodeId: 'pc01', provider: 'ollama', model: 'qwen2.5-coder:14b', availability: 'busy', healthScore: 98, concurrencyLimit: 1, activeTaskCount: 1, currentTaskIds: ['WO-059'] },
      { employeeId: 'analyst-01', displayName: 'Analyst AI', department: 'Research', role: 'Analysis', nodeId: 'pc01', provider: 'ollama', model: 'qwen3:8b', availability: 'idle', healthScore: 97, concurrencyLimit: 1, activeTaskCount: 0, currentTaskIds: [] },
      { employeeId: 'reviewer-01', displayName: 'Reviewer AI', department: 'Quality', role: 'Review', nodeId: 'pc01', provider: 'ollama', model: 'qwen3:8b', availability: 'busy', healthScore: 99, concurrencyLimit: 1, activeTaskCount: 1, currentTaskIds: ['REV-059'] },
    ],
    taskList: [
      { taskId: 'WO-059', objective: 'Hoàn thiện Owner Cockpit', stage: 'running', priority: 'P0', assignedEmployeeId: 'coder-01' },
      { taskId: 'REV-059', objective: 'Review giao diện', stage: 'running', priority: 'P0', assignedEmployeeId: 'reviewer-01' },
    ],
  },
  postgresql: { online: true, service: 'postgresql-x64-17', port: 5432 },
  ollama: { online: true, models: ['qwen3:8b', 'qwen2.5-coder:14b'] },
  tailscale: { online: true, ip: '100.97.23.87' },
  gpu: { name: 'Radeon RX 5500 XT', utilizationPercent: 4, memoryUsedMiB: 256, memoryTotalMiB: 8192 },
};

async function setup(commandSecret = '') {
  const plane = new ControlPlane();
  plane.create({ id: 'WO-059', project: 'TigerIQ', goal: 'Owner Cockpit <script>alert(1)</script>', scope: ['dashboard'], invariants: ['private'], acceptanceCriteria: ['visual'], status: 'running' }, { id: 'planner', role: 'planner' });
  const submitJob = vi.fn(async () => 'https://github.com/newsdayads/tigeriq-ai-lab/issues/999');
  const backend = await startDashboard(plane, { commandSecret, submitJob, serverTelemetry: async () => telemetry });
  closers.push(backend.close);
  const outer = await startOwnerCockpitV3({ backendUrl: backend.url });
  closers.push(outer.close);
  return { outer, submitJob };
}

describe('Owner Cockpit V3', () => {
  it('renders a visibly distinct owner-first shell with scalable workforce and model registry', async () => {
    const { outer } = await setup();
    const response = await fetch(outer.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain('OWNER COCKPIT V3 · VISUAL REBUILD');
    expect(html).toContain('CÔNG VIỆC ĐANG CHẠY');
    expect(html).toContain('CẦN ANH SƠN');
    expect(html).toContain('AI WORKFORCE — AI ĐANG LÀM GÌ');
    expect(html).toContain('Tổng AI <b>4</b>');
    expect(html).toContain('Coder AI');
    expect(html).toContain('Reviewer AI');
    expect(html).toContain('qwen2.5-coder:14b');
    expect(html).toContain('MÔ HÌNH AI HIỆN CÓ');
    expect(html).toContain('<details class="runtime"');
    expect(html).toContain('PC01 SERVER & SERVICES');
    expect(html).toContain('Segoe UI Variable');
    expect(html).toContain('Owner Cockpit &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('filters a larger workforce server-side without client scripts', async () => {
    const { outer } = await setup();
    const response = await fetch(`${outer.url}/?ai=coder&state=busy`);
    const html = await response.text();
    expect(html).toContain('Coder AI');
    expect(html).not.toContain('Analyst AI');
    expect(html).not.toContain('Reviewer AI');
    expect(html).toContain('Hiển thị 1/4 AI');
  });

  it('proxies login and durable job submission through the visual shell', async () => {
    const { outer, submitJob } = await setup('local-test-secret');
    const login = await fetch(`${outer.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: 'local-test-secret' }),
      redirect: 'manual',
    });
    expect(login.status).toBe(303);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toContain('tigeriq_session=');
    const page = await fetch(outer.url, { headers: { cookie: cookie! } });
    const html = await page.text();
    expect(html).toContain('GIAO VIỆC CHO VY');
    const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
    const idempotency = html.match(/name="idempotency" value="([^"]+)"/)?.[1];
    expect(csrf).toBeTruthy();
    expect(idempotency).toBeTruthy();
    const job = await fetch(`${outer.url}/jobs`, {
      method: 'POST',
      headers: { cookie: cookie!, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ instruction: 'Làm UI v3', priority: 'Cao', csrf: csrf!, idempotency: idempotency! }),
      redirect: 'manual',
    });
    expect(job.status).toBe(303);
    expect(submitJob).toHaveBeenCalledTimes(1);
  });
});
