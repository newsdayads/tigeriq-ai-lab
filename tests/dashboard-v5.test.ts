import { afterEach, describe, expect, it } from 'vitest';
import { ControlPlane } from '../packages/control-plane/src/index.js';
import { startDashboard, type ServerTelemetry } from '../apps/dashboard/src/server.js';
import { startOwnerCockpitV5, type GithubControlAdapter } from '../apps/dashboard/src/server-v5.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()?.(); });

const telemetry: ServerTelemetry = {
  available: true,
  server: 'PC01',
  generatedAt: '2026-09-04T02:30:00.000Z',
  cpu: { utilizationPercent: 22 },
  memory: { usedBytes: 20 * 1024 ** 3, totalBytes: 64 * 1024 ** 3, utilizationPercent: 31 },
  uptimeSeconds: 500000,
  disk: { drive: 'F:', freeBytes: 620 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, utilizationPercent: 38 },
  worker: { online: true, pid: 45628, instances: 1 },
  controller: { online: true, ip: '100.97.23.87', port: 8790 },
  workforce: {
    employeesTotal: 2, idle: 1, busy: 1, offline: 0, degraded: 0, activeTasks: 1, tasksActive: 1, tasksFailed: 0,
    roster: [
      { employeeId: 'coder-01', displayName: 'Coder AI', department: 'Engineering', role: 'Code & Script', nodeId: 'pc01', provider: 'ollama', model: 'qwen2.5-coder:14b', availability: 'busy', healthScore: 98, concurrencyLimit: 1, activeTaskCount: 1, currentTaskIds: ['WO-261'] },
      { employeeId: 'analyst-01', displayName: 'Analyst AI', department: 'Research', role: 'Analysis', nodeId: 'pc01', provider: 'ollama', model: 'qwen3:8b', availability: 'idle', healthScore: 97, concurrencyLimit: 1, activeTaskCount: 0, currentTaskIds: [] },
    ],
    taskList: [{ taskId: 'WO-261', objective: 'Hoàn thiện Web Control Functional V1', stage: 'running', priority: 'P0', assignedEmployeeId: 'coder-01' }],
  },
  postgresql: { online: true, service: 'postgresql-x64-17', port: 5432 },
  ollama: { online: true, models: ['qwen3:8b', 'qwen2.5-coder:14b'] },
  tailscale: { online: true, ip: '100.97.23.87' },
  gpu: { name: 'Radeon RX 5500 XT', utilizationPercent: 12, memoryUsedMiB: 512, memoryTotalMiB: 8192 },
};

function fixturePlane() {
  const plane = new ControlPlane();
  plane.create({ id: 'WO-261', project: 'TigerIQ', goal: 'Hoàn thiện Web Control Functional V1', scope: ['dashboard'], invariants: ['private'], acceptanceCriteria: ['functional'], status: 'draft' }, { id: 'planner', role: 'planner' });
  plane.transition('WO-261', 'approved', { id: 'approver', role: 'approver' });
  plane.transition('WO-261', 'running', { id: 'coder', role: 'coder' });
  plane.create({ id: 'WO-OWNER-DECISION', project: 'TigerIQ', goal: 'Cần anh Sơn phê duyệt tiếp tục công việc thử nghiệm', scope: ['owner'], invariants: ['private'], acceptanceCriteria: ['owner decision'], status: 'draft' }, { id: 'planner', role: 'planner' });
  plane.transition('WO-OWNER-DECISION', 'blocked', { id: 'operator', role: 'operator' });
  return plane;
}

function githubFixture() {
  const commentsWritten: Array<{ issue: number; body: string }> = [];
  const created: Array<{ title: string; body: string }> = [];
  const closed: number[] = [];
  const adapter: GithubControlAdapter = {
    async listIssues() {
      return [{ number: 777, title: '[Command Center][WO-OWNER-DECISION] test', body: 'TIGERIQ_JOB_V1\n\n## Work Order\nWO-OWNER-DECISION\n\n## Instruction\nCần anh Sơn phê duyệt tiếp tục công việc thử nghiệm', state: 'open', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/777' }];
    },
    async comments() {
      return [{ id: 1, body: 'TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW\nCần quyết định Owner.', created_at: '2026-09-04T02:20:00Z', updated_at: '2026-09-04T02:20:00Z', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/777#issuecomment-1' }];
    },
    async comment(issue, body) { commentsWritten.push({ issue, body }); },
    async close(issue) { closed.push(issue); },
    async create(title, body) { created.push({ title, body }); return 'https://github.com/newsdayads/tigeriq-ai-lab/issues/778'; },
  };
  return { adapter, commentsWritten, created, closed };
}

describe('Owner Cockpit V5 functional contract', () => {
  it('renders real sections, server-side search, evidence detail and truthful progress label', async () => {
    const backend = await startDashboard(fixturePlane(), { serverTelemetry: async () => telemetry });
    closers.push(backend.close);
    const github = githubFixture();
    const outer = await startOwnerCockpitV5({ backendUrl: backend.url, repo: 'newsdayads/tigeriq-ai-lab', github: github.adapter, readUpdaterState: async () => ({ result: 'UPDATED', installedSha: 'a'.repeat(40), updatedAt: '2026-09-04T02:25:00Z', error: null, runId: '99' }) });
    closers.push(outer.close);

    const page = await (await fetch(`${outer.url}/?work=WO-OWNER-DECISION`)).text();
    expect(page).toContain('Báo cáo vận hành');
    expect(page).toContain('Cài đặt');
    expect(page).toContain('Bộ cập nhật Web Control V3');
    expect(page).toContain('a'.repeat(12));
    expect(page).toContain('Lifecycle / bằng chứng thực tế');
    expect(page).toContain('Cần quyết định bên ngoài');
    expect(page).toContain('ước lượng');
    expect(page).toContain('Điều chuyển AI / đổi model: Chưa khả dụng');
    expect(page).not.toContain('<section id="bao-cao" hidden>');
    expect(page).not.toContain('<section id="cai-dat" hidden>');

    const filtered = await (await fetch(`${outer.url}/?q=qwen3`)).text();
    expect(filtered).toContain('qwen3:8b');
    expect(filtered).not.toContain('Hoàn thiện Web Control Functional V1</b>');
  });

  it('requires login + csrf and records an approved Owner decision before creating continuation work', async () => {
    const backend = await startDashboard(fixturePlane(), { commandSecret: 'test-secret', serverTelemetry: async () => telemetry });
    closers.push(backend.close);
    const github = githubFixture();
    const outer = await startOwnerCockpitV5({ backendUrl: backend.url, repo: 'newsdayads/tigeriq-ai-lab', github: github.adapter, readUpdaterState: async () => ({ result: 'NO_CHANGE', installedSha: 'b'.repeat(40), updatedAt: null, error: null, runId: null }) });
    closers.push(outer.close);

    const login = await fetch(`${outer.url}/login`, { method: 'POST', body: new URLSearchParams({ secret: 'test-secret' }), headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
    expect(login.status).toBe(303);
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    expect(cookie).toContain('tigeriq_session=');

    const authorizedPage = await (await fetch(`${outer.url}/?work=WO-OWNER-DECISION`, { headers: { cookie } })).text();
    const csrf = authorizedPage.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
    expect(csrf).not.toBe('');
    expect(authorizedPage).toContain('Duyệt &amp; tiếp tục');

    const decision = await fetch(`${outer.url}/decision`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf, workOrderId: 'WO-OWNER-DECISION', decision: 'approve', idempotency: 'decision-test-123456' }),
      redirect: 'manual',
    });
    expect(decision.status).toBe(303);
    expect(github.commentsWritten).toHaveLength(1);
    expect(github.commentsWritten[0]?.body).toContain('TIGERIQ_OWNER_DECISION_V1');
    expect(github.commentsWritten[0]?.body).toContain('decision=APPROVED');
    expect(github.created).toHaveLength(1);
    expect(github.created[0]?.body).toContain('TIGERIQ_JOB_V1');
    expect(github.created[0]?.body).toContain('Anh Sơn đã DUYỆT');
    expect(github.closed).toHaveLength(0);
  });

  it('rejects unauthenticated writes and supports bounded read-only system commands after login', async () => {
    const backend = await startDashboard(fixturePlane(), { commandSecret: 'test-secret', serverTelemetry: async () => telemetry });
    closers.push(backend.close);
    const github = githubFixture();
    const outer = await startOwnerCockpitV5({ backendUrl: backend.url, repo: 'newsdayads/tigeriq-ai-lab', github: github.adapter, readUpdaterState: async () => ({ result: 'NO_CHANGE', installedSha: null, updatedAt: null, error: null, runId: null }) });
    closers.push(outer.close);

    const denied = await fetch(`${outer.url}/system-action`, { method: 'POST', body: new URLSearchParams({ csrf: 'x', action: 'system-status', idempotency: 'system-test-123456' }) });
    expect(denied.status).toBe(403);

    const login = await fetch(`${outer.url}/login`, { method: 'POST', body: new URLSearchParams({ secret: 'test-secret' }), headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    const page = await (await fetch(outer.url, { headers: { cookie } })).text();
    const csrf = page.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
    const action = await fetch(`${outer.url}/system-action`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, action: 'system-status', idempotency: 'system-test-123456' }), redirect: 'manual' });
    expect(action.status).toBe(303);
    expect(github.created.at(-1)?.body).toContain('TIGERIQ_COMMAND_V1');
    expect(github.created.at(-1)?.body).toContain('system.status');
  });
});
