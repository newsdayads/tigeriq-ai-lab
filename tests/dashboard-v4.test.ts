import { afterEach, describe, expect, it } from 'vitest';
import { ControlPlane } from '../packages/control-plane/src/index.js';
import { startDashboard, type ServerTelemetry } from '../apps/dashboard/src/server.js';
import { startOwnerCockpitV4 } from '../apps/dashboard/src/server-v4.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()?.(); });

const telemetry: ServerTelemetry = {
  available: true,
  server: 'PC01',
  generatedAt: '2026-09-03T16:30:00.000Z',
  cpu: { utilizationPercent: 12 },
  memory: { usedBytes: 18 * 1024 ** 3, totalBytes: 64 * 1024 ** 3, utilizationPercent: 28 },
  uptimeSeconds: 400000,
  disk: { drive: 'F:', freeBytes: 680 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, utilizationPercent: 32 },
  worker: { online: true, pid: 45628, instances: 1 },
  controller: { online: true, ip: '100.97.23.87', port: 8790 },
  workforce: {
    employeesTotal: 2, idle: 1, busy: 1, offline: 0, degraded: 0, activeTasks: 1, tasksActive: 1, tasksFailed: 0,
    roster: [
      { employeeId: 'coder-01', displayName: 'Coder AI', department: 'Engineering', role: 'Code & Script', nodeId: 'pc01', provider: 'ollama', model: 'qwen2.5-coder:14b', availability: 'busy', healthScore: 98, concurrencyLimit: 1, activeTaskCount: 1, currentTaskIds: ['WO-214'] },
      { employeeId: 'analyst-01', displayName: 'Analyst AI', department: 'Research', role: 'Analysis', nodeId: 'pc01', provider: 'ollama', model: 'qwen3:8b', availability: 'idle', healthScore: 97, concurrencyLimit: 1, activeTaskCount: 0, currentTaskIds: [] },
    ],
    taskList: [{ taskId: 'WO-214', objective: 'Hoàn thiện WebControl theo mockup', stage: 'running', priority: 'P0', assignedEmployeeId: 'coder-01' }],
  },
  postgresql: { online: true, service: 'postgresql-x64-17', port: 5432 },
  ollama: { online: true, models: ['qwen3:8b', 'qwen2.5-coder:14b'] },
  tailscale: { online: true, ip: '100.97.23.87' },
  gpu: { name: 'Radeon RX 5500 XT', utilizationPercent: 5, memoryUsedMiB: 256, memoryTotalMiB: 8192 },
};

describe('Owner Cockpit V4 mockup-first visual contract', () => {
  it('is visibly distinct from the old sidebar dashboard and keeps owner-first sections', async () => {
    const plane = new ControlPlane();
    plane.create({ id: 'WO-214', project: 'TigerIQ', goal: 'Hoàn thiện WebControl theo mockup', scope: ['dashboard'], invariants: ['private'], acceptanceCriteria: ['visual'], status: 'draft' }, { id: 'planner', role: 'planner' });
    plane.transition('WO-214', 'approved', { id: 'approver', role: 'approver' });
    plane.transition('WO-214', 'running', { id: 'coder', role: 'coder' });
    const backend = await startDashboard(plane, { serverTelemetry: async () => telemetry });
    closers.push(backend.close);
    const outer = await startOwnerCockpitV4({ backendUrl: backend.url });
    closers.push(outer.close);

    const response = await fetch(outer.url);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('OWNER COCKPIT V4 · MOCKUP IMPLEMENTATION');
    expect(page).toContain('Hôm nay TigerIQ đang làm gì cho anh Sơn?');
    expect(page).toContain('CÔNG VIỆC ĐANG CHẠY');
    expect(page).toContain('CẦN ANH SƠN');
    expect(page).toContain('AI WORKFORCE — AI ĐANG LÀM GÌ');
    expect(page).toContain('MÔ HÌNH AI HIỆN CÓ');
    expect(page).toContain('PC01 SERVER & SERVICES — HẠ TẦNG KỸ THUẬT');
    expect(page).toContain('class="topnav"');
    expect(page).not.toContain('class="side"');
    expect(page).toContain('Coder AI');
    expect(page).toContain('qwen2.5-coder:14b');
    expect(page).toContain('@media(max-width:520px)');
    expect(page).toContain('Segoe UI Variable');
  });
});
