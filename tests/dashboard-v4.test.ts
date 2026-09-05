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

describe('Owner Cockpit Vietnamese management visual contract', () => {
  it('uses sidebar navigation, compact management tables, one font system and Vietnamese labels', async () => {
    const plane = new ControlPlane();
    plane.create({ id: 'WO-214', project: 'TigerIQ', goal: 'Hoàn thiện WebControl theo mockup', scope: ['dashboard'], invariants: ['private'], acceptanceCriteria: ['visual'], status: 'draft' }, { id: 'planner', role: 'planner' });
    plane.transition('WO-214', 'approved', { id: 'approver', role: 'approver' });
    plane.transition('WO-214', 'running', { id: 'coder', role: 'coder' });

    plane.create({ id: 'WO-TECH-BLOCK', project: 'TigerIQ', goal: 'Thiếu mô hình đánh giá độc lập, hệ thống tự xử lý', scope: ['worker'], invariants: ['private'], acceptanceCriteria: ['runtime'], status: 'draft' }, { id: 'planner', role: 'planner' });
    plane.transition('WO-TECH-BLOCK', 'blocked', { id: 'operator', role: 'operator' });

    plane.create({ id: 'WO-OWNER-DECISION', project: 'TigerIQ', goal: 'Cần anh Sơn phê duyệt thay đổi quyền truy cập', scope: ['security'], invariants: ['private'], acceptanceCriteria: ['owner decision'], status: 'draft' }, { id: 'planner', role: 'planner' });
    plane.transition('WO-OWNER-DECISION', 'blocked', { id: 'operator', role: 'operator' });

    const backend = await startDashboard(plane, { serverTelemetry: async () => telemetry });
    closers.push(backend.close);
    const outer = await startOwnerCockpitV4({ backendUrl: backend.url });
    closers.push(outer.close);

    const response = await fetch(outer.url);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('TigerIQ — Bảng điều hành');
    expect(page).toContain('Xin chào anh Sơn');
    expect(page).toContain('Công việc đang xử lý');
    expect(page).toContain('Cần anh Sơn');
    expect(page).toContain('Đội AI đang làm gì');
    expect(page).toContain('Mô hình AI');
    expect(page).toContain('Bằng chứng & kiểm tra');
    expect(page).toContain('Trạng thái hệ thống PC01');
    expect(page).toContain('class="sidebar"');
    expect(page).toContain('class="nav"');
    expect(page).not.toContain('OWNER COCKPIT V4 · MOCKUP IMPLEMENTATION');
    expect(page).not.toContain('AI WORKFORCE — AI ĐANG LÀM GÌ');
    expect(page).not.toContain('🐯');
    expect(page).not.toContain('class="topnav"');
    expect(page).not.toContain('>TQ</div>');
    expect(page).toContain('<svg class="ico"');
    expect(page).toContain('Coder AI');
    expect(page).toContain('Lập trình &amp; tự động hóa');
    expect(page).toContain('Kỹ thuật');
    expect(page).toContain('qwen2.5-coder:14b');
    expect(page).toContain('Chờ anh quyết định</span><strong>1</strong>');
    expect(page).toContain('Lỗi / đang vướng</span><strong>2</strong>');
    expect(page).toContain('Cần anh quyết định hoặc phê duyệt để tiếp tục');
    expect(page).toContain('@media(max-width:760px)');
    expect(page).toContain('Segoe UI Variable');
  });
});