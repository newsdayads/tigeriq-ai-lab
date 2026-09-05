import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ServerTelemetry } from '../apps/dashboard/src/server.js';
import { ownerCodeV8, ownershipEventV8, renderManagementPanelV8, resolveLaneIssueNumbersV8, resolvePriorityIssueNumberV8 } from '../apps/dashboard/src/server-v8.js';

function telemetry(): ServerTelemetry {
  return {
    available: true,
    server: 'PC01',
    generatedAt: '2026-09-05T03:00:00.000Z',
    cpu: null,
    memory: null,
    uptimeSeconds: 7200,
    disk: null,
    worker: { online: true, pid: 123, instances: 1 },
    controller: { online: true, ip: '127.0.0.1', port: 8790 },
    workforce: { employeesTotal: 0, idle: 0, busy: 0, offline: 0, degraded: 0, activeTasks: 0, tasksActive: 0, tasksFailed: 0, roster: [] },
    postgresql: { online: true, service: 'postgresql', port: 5432 },
    ollama: { online: true, models: ['qwen3:8b'] },
    tailscale: { online: true, ip: '100.97.23.87' },
    gpu: null,
  };
}

const central = {
  number: 280,
  state: 'open',
  updated_at: '2026-09-05T02:53:43Z',
  body: '## Ưu tiên hiện hành — 2026-09-05\n1. **Khoa (NV02 — Vận hành tự động): P0 hệ thống — #306 Auto Worker V13.4.5.**\n2. **Khải (NV04 — Kỹ sư Tích hợp AI/API): P0 song song — #392.**\n3. **Minh (NV01 — Thực thi trực tiếp): foreground Web continuity — #322 + #261 preparation.**',
};
const registry = {
  number: 335,
  state: 'open',
  updated_at: '2026-09-05T02:44:47Z',
  body: '`3` | `NV03` | false — TẠM NGƯNG\nNV03 active=false TẠM NGƯNG\n`4` | `NV04` | true',
};
const issue306 = {
  number: 306,
  state: 'open',
  updated_at: '2026-09-05T02:50:00Z',
  title: '[P0][KHOA / AUTO WORKER] Recovery + Minh/Khoa ownership failover',
  body: '## Người phụ trách\n- **Khoa — NV02 — Vận hành tự động**.\n\n## Acceptance A–N\nI. Minh active scope X -> Khoa không chạm X.\nJ. Minh stale hợp lệ -> takeover theo policy.',
};
const issue392 = {
  number: 392,
  state: 'open',
  updated_at: '2026-09-05T02:52:00Z',
  title: '[P0 SONG SONG][NV04][AI/API] Khải — Tích hợp AI/API',
  body: '## Nhân sự\n**Khải (NV04 — Kỹ sư Tích hợp AI/API)**',
};
const issue322 = {
  number: 322,
  state: 'open',
  updated_at: '2026-09-05T02:54:00Z',
  title: '[P1][WEB CONTROL] Tổng quan phải hiển thị Mục tiêu → Hạng mục → Bước hiện tại',
  body: '## Điều kiện đóng #322\nChỉ đóng khi ownership/failover có evidence thật.',
};

const comments306 = [{ body: 'TIGERIQ_JOB_CLAIMED\nemployee_id=NV02\nowner=Khoa (NV02 — Vận hành tự động)\nstate=ĐANG_XỬ_LÝ', created_at: '2026-09-05T02:50:10Z' }];
const comments392 = [{ body: 'TIGERIQ_JOB_CLAIMED\nemployee_id=NV04\nowner=Khải (NV04 — Kỹ sư Tích hợp AI/API)\nstate=ĐANG_XỬ_LÝ', created_at: '2026-09-05T02:52:10Z' }];
const comments322 = [{ body: 'TIGERIQ_JOB_PROGRESS\nemployee_id=NV01\nstate=CHỜ_E2E_THẬT_KHÔNG_FAKE_PASS', created_at: '2026-09-05T02:54:10Z' }];

describe('Web Local #322 ownership-aware V4', () => {
  it('resolves current P0 and parallel lane issue numbers from current CENTRAL body', () => {
    expect(resolvePriorityIssueNumberV8(central, [])).toBe(306);
    expect(resolveLaneIssueNumbersV8(central, 306)).toEqual([306, 392, 322]);
  });

  it('does not mis-assign #306 to NV01 just because its body mentions Minh', () => {
    expect(ownerCodeV8(issue306, [])).toBe('NV02');
    expect(ownerCodeV8(issue306, comments306)).toBe('NV02');
  });

  it('resolves NV04 from explicit claim/title', () => {
    expect(ownerCodeV8(issue392, comments392)).toBe('NV04');
  });

  it('renders NV04, correct #306 owner, and distinct parallel lane states', () => {
    const html = renderManagementPanelV8(telemetry(), {
      central,
      centralComments: [],
      registry,
      currentIssue: issue306,
      currentComments: comments306,
      lanes: [
        { issue: issue306, comments: comments306 },
        { issue: issue392, comments: comments392 },
        { issue: issue322, comments: comments322 },
      ],
      installedSha: '0123456789abcdef0123456789abcdef01234567',
    }, new Date('2026-09-05T03:00:00Z'));
    expect(html).toContain('#306');
    expect(html).toContain('Khoa (NV02 — Vận hành tự động)');
    expect(html).toContain('Khải (NV04 — Kỹ sư Tích hợp AI/API)');
    expect(html).toContain('ĐANG XỬ LÝ #392');
    expect(html).toContain('ĐANG CHỜ #322');
    expect(html).toContain('QUYỀN XỬ LÝ / CHUYỂN GIAO');
    expect(html).toContain('WEB-LOCAL-322-V4');
  });

  it('shows only explicit ownership/failover evidence and otherwise stays neutral', () => {
    const base = {
      central,
      centralComments: [],
      registry,
      currentIssue: issue306,
      currentComments: comments306,
      lanes: [{ issue: issue306, comments: comments306 }],
      installedSha: null,
    };
    expect(ownershipEventV8(base).label).toBe('KHÔNG CÓ SỰ KIỆN MỚI');
    const withHold = {
      ...base,
      centralComments: [{ body: 'OWNER_HOLD=true\nscope=#322', created_at: '2026-09-05T03:01:00Z' }],
    };
    expect(ownershipEventV8(withHold).label).toBe('GIỮ QUYỀN XỬ LÝ');
  });

  it('retains V4 module behavior and provenance when a newer presentation layer becomes current', () => {
    const source = readFileSync(new URL('../apps/dashboard/src/server-v8.ts', import.meta.url), 'utf8');
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    for (const expected of [
      'WEB-LOCAL-322-V4', 'Khải (NV04 — Kỹ sư Tích hợp AI/API)', 'QUYỀN XỬ LÝ / CHUYỂN GIAO',
      'ownershipEventV8', 'startOwnerCockpitV8',
    ]) expect(source).toContain(expected);
    expect(standalone).toContain('startOwnerCockpitV8');
    expect(standalone).toContain('WEB-LOCAL-322-V4');
    expect(standalone).toContain('WEB-LOCAL-396-V3.1');
  });
});
