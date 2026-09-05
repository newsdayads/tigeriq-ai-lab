import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ServerTelemetry } from '../apps/dashboard/src/server.js';
import { controlPlaneState, renderManagementPanel, resolvePriorityIssueNumber } from '../apps/dashboard/src/server-v7.js';

function telemetry(controller: ServerTelemetry['controller'], available = true): ServerTelemetry {
  return {
    available,
    server: 'PC01',
    generatedAt: '2026-09-05T02:30:00.000Z',
    cpu: null,
    memory: null,
    uptimeSeconds: 7200,
    disk: null,
    worker: { online: true, pid: 123, instances: 1 },
    controller,
    workforce: { employeesTotal: 0, idle: 0, busy: 0, offline: 0, degraded: 0, activeTasks: 0, tasksActive: 0, tasksFailed: 0, roster: [] },
    postgresql: { online: true, service: 'postgresql', port: 5432 },
    ollama: { online: true, models: ['qwen3:8b'] },
    tailscale: { online: true, ip: '100.97.23.87' },
    gpu: null,
  };
}

const registry = { number: 335, state: 'open', updated_at: '2026-09-05T02:20:00Z', body: '`3` | `NV03` | false — TẠM NGƯNG\nNV03 active=false TẠM NGƯNG' };
const central = { number: 280, state: 'open', updated_at: '2026-09-05T02:32:44Z', body: '## P0 hiện hành sau #338 — Khoa/NV02 / #306 Auto Worker' };
const centralComments = [
  { body: 'AUDIT\nƯU TIÊN HIỆN HÀNH:\n1. #390 — Minh/NV01 / Web V3\n2. #306 — Khoa/NV02', created_at: '2026-09-05T02:27:00Z' },
];
const currentIssue = {
  number: 390,
  state: 'open',
  updated_at: '2026-09-05T02:32:36Z',
  title: '[P0][NV01][WEB V3] Bảng điều hành quản trị — trạng thái động',
  body: '## Điều kiện ĐẠT\n- Tải lại 8787 thấy P0 hiện hành khớp CENTRAL #280.',
};
const currentComments = [
  { body: 'TIGERIQ_JOB_CLAIMED\ncommand=1\nemployee_id=NV01\nstate=ĐANG_XỬ_LÝ', created_at: '2026-09-05T02:33:00Z' },
];

describe('Web Local #390 dynamic management projection', () => {
  it('prefers the newest CENTRAL current-priority directive over stale body snapshot', () => {
    expect(resolvePriorityIssueNumber(central, centralComments)).toBe(390);
    expect(resolvePriorityIssueNumber(central, [])).toBe(306);
  });

  it('renders current work dynamically and removes stale #338 P0 semantics', () => {
    const html = renderManagementPanel(telemetry({ online: true, ip: '127.0.0.1', port: 8790 }), {
      central, centralComments, registry, currentIssue, currentComments, installedSha: '0123456789abcdef0123456789abcdef01234567',
    }, new Date('2026-09-05T02:35:00Z'));
    for (const expected of [
      'BẢNG ĐIỀU HÀNH TRẠNG THÁI ĐỘNG', '#390', 'Minh (NV01 — Thực thi trực tiếp)', 'Khoa (NV02 — Vận hành tự động)',
      'Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)', 'TẠM NGƯNG', 'PC01 SERVER', 'TIGERIQ CONTROL PLANE', 'AI PC01',
      'CẦN ANH SƠN', 'WEB-LOCAL-390-V3', 'ĐANG XỬ LÝ', 'Không có việc nào đang cần anh Sơn',
    ]) expect(html).toContain(expected);
    expect(html).not.toContain('WEB LOCAL P0 · #338');
    expect(html).not.toContain('Xuất bản local 8787 → tải lại → kiểm chứng evidence');
    expect(html).not.toContain('CHƯA CÓ BẰNG CHỨNG ACTIVE');
  });

  it('shows non-owner employees as neutral waiting instead of warning states', () => {
    const html = renderManagementPanel(telemetry({ online: true, ip: '127.0.0.1', port: 8790 }), {
      central, centralComments, registry, currentIssue, currentComments, installedSha: null,
    });
    expect(html).toContain('Khoa (NV02 — Vận hành tự động)');
    expect(html).toContain('CHỜ VIỆC');
  });

  it('keeps Controller failure distinct from PC01 host health', () => {
    const state = controlPlaneState(telemetry({ online: false, ip: '127.0.0.1', port: 8790 }));
    expect(state.label).toContain('SUY GIẢM');
    expect(state.css).toBe('bad');
  });

  it('does not present a closed resolved issue as active work', () => {
    const html = renderManagementPanel(telemetry({ online: true, ip: '127.0.0.1', port: 8790 }), {
      central, centralComments, registry, currentIssue: { ...currentIssue, state: 'closed' }, currentComments, installedSha: null,
    });
    expect(html).toContain('HOÀN TẤT — CHỜ CENTRAL CHUYỂN P0');
    expect(html).toContain('CENTRAL #280 chọn P0 kế tiếp');
  });

  it('retains V3 dynamic-governance behavior and provenance after newer UI versions become current', () => {
    const source = readFileSync(new URL('../apps/dashboard/src/server-v7.ts', import.meta.url), 'utf8');
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    for (const expected of [
      'WEB-LOCAL-390-V3', 'resolvePriorityIssueNumber', "ghJson<Comment[]>(repo, 'issues/280/comments?per_page=100')", 'startOwnerCockpitV7',
    ]) expect(source).toContain(expected);
    expect(standalone).toContain('WEB-LOCAL-390-V3');
    expect(standalone).toContain('WEB-LOCAL-322-V4');
    expect(standalone).toContain('WEB-LOCAL-396-V3.1');
  });
});
