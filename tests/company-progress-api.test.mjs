import { describe, expect, it } from 'vitest';
import { inferOwnerAction, parseCentralPriorities, parseEmployees, projectProgress } from '../api/company-progress.mjs';

function pull(title = 'WO-031: Mobile Workforce Board') {
  return { title, body: '', number: 93, head: { sha: 'abc', ref: 'wo031/test' } };
}

function run(name, status = 'completed', conclusion = 'success') {
  return { name, status, conclusion, updated_at: '2026-08-31T00:00:00.000Z' };
}

describe('company progress calculation', () => {
  it('derives progress only from explicit gates', () => {
    const result = projectProgress({
      pull: pull(),
      runs: [run('CI'), run('WO-014 Queue Hygiene'), run('WO-012/013 Vercel Online Verify')],
    });
    expect(result.progressPct).toBe(80);
    expect(result.gates.map((gate) => gate.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pending']);
    expect(result.currentStep).toContain('chuẩn bị merge/Production');
  });

  it('shows a failed gate as current work instead of inflating progress', () => {
    const result = projectProgress({
      pull: pull(),
      runs: [run('CI', 'completed', 'failure'), run('WO-014 Queue Hygiene')],
    });
    expect(result.progressPct).toBe(40);
    expect(result.currentStep).toContain('Đang sửa lỗi');
  });

  it('adds the Android Worker build gate only when the work requires Android', () => {
    const result = projectProgress({
      pull: pull('WO-030: Android secure controller client'),
      runs: [run('CI'), run('WO-014 Queue Hygiene'), run('WO-012/013 Vercel Online Verify'), run('Android Worker')],
    });
    expect(result.gates.some((gate) => gate.name === 'Android Worker')).toBe(true);
    expect(result.progressPct).toBe(83);
  });
});

describe('public authoritative projection', () => {
  it('parses legacy ordered P0/P1/P2 entries from CENTRAL without inventing work', () => {
    const rows = parseCentralPriorities('### 1. P0 #423 — Website\n### 2. P1 #401 — Autonomy\n### #368 — done');
    expect(rows).toEqual([
      { priority: 'P0', number: 423, label: 'Website' },
      { priority: 'P1', number: 401, label: 'Autonomy' },
    ]);
  });

  it('parses the current dynamic P0 owner heading and first declared issue', () => {
    const body = '### Khoa/NV02 — P0\n- APP issue: **#441**.\n- Successor: PR **#443**.\n### Minh/NV01\n- Continuity: **#322 + #261**.';
    expect(parseCentralPriorities(body)).toEqual([
      { priority: 'P0', number: 441, label: 'Khoa/NV02' },
    ]);
  });

  it('parses active and paused employees from the legacy registry table', () => {
    const body = '| `2` | `NV02` | `autonomous` | `P0` | `queue` | `Khoa (NV02 — Vận hành tự động)` | true |\n| `3` | `NV03` | `specialized` | `P0` | `local` | `Huy (NV03)` | **false — TẠM NGƯNG** |';
    const rows = parseEmployees(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ command: 2, employeeId: 'NV02', active: true });
    expect(rows[1]).toMatchObject({ command: 3, employeeId: 'NV03', active: false });
  });

  it('parses the current registry command table and activation state', () => {
    const body = '| command | employee | mode | background | enabled | activation |\n|---|---|---|---|---|---|\n| `1` | `NV01 / Minh` | `foreground_interactive` | false | true | ACTIVE |\n| `2` | `NV02 / Khoa` | `background_auto` | **true** | true | ACTIVE |\n| `3` | `NV03 / Huy` | `paused_specialized` | false | false | PAUSED |';
    const rows = parseEmployees(body);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ command: 1, employeeId: 'NV01', mode: 'foreground_interactive', active: true });
    expect(rows[1]).toMatchObject({ command: 2, employeeId: 'NV02', mode: 'background_auto', background: true, active: true });
    expect(rows[2]).toMatchObject({ command: 3, employeeId: 'NV03', active: false, enabled: false });
  });

  it('does not mistake descriptive owner-question prose for a real owner action', () => {
    expect(inferOwnerAction('UI phải cho biết có cần anh Sơn làm gì không.').required).toBe(false);
    expect(inferOwnerAction('STATE=CHỜ ANH SƠN').required).toBe(true);
  });
});
