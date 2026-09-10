import { describe, expect, it } from 'vitest';
import { inferDeclaredExecutor, inferOwnerAction, parseCentralPriorities, parseEmployees, projectProgress } from '../api/company-progress.mjs';

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
  it('parses ordered P0/P1/P2 entries from CENTRAL without inventing work', () => {
    const rows = parseCentralPriorities('### 1. P0 #423 — Website\n### 2. P1 #401 — Autonomy\n### #368 — done');
    expect(rows).toEqual([
      { priority: 'P0', number: 423, label: 'Website' },
      { priority: 'P1', number: 401, label: 'Autonomy' },
    ]);
  });

  it('preserves the intermediate CENTRAL owner-heading format', () => {
    const body = '### Khoa/NV02 — P0\n- APP issue: **#441**.\n- Successor: PR **#443**.\n### Minh/NV01\n- Continuity: **#322 + #261**.';
    expect(parseCentralPriorities(body)).toEqual([
      { priority: 'P0', number: 441, label: 'Khoa/NV02' },
    ]);
  });

  it('parses CENTRAL v12 current owner priority list', () => {
    const body = '## CURRENT OWNER PRIORITY — 2026-09-10\n1. **#556 — Source Truth + HOT STATE**: highest P0.\n2. **#478 — Zero-touch framework**: next safe P0.\n3. **#318 — PC01 autonomous 24/7 master**: backend continues.\n\n## FAST-START CONTRACT';
    expect(parseCentralPriorities(body)).toEqual([
      { priority: 'P0', number: 556, label: 'Source Truth + HOT STATE' },
      { priority: 'P0', number: 478, label: 'Zero-touch framework' },
      { priority: 'P0', number: 318, label: 'PC01 autonomous 24/7 master' },
    ]);
  });

  it('parses CENTRAL v16 Vietnamese current priority heading', () => {
    const body = '## ƯU TIÊN HIỆN HÀNH — 2026-09-10\n1. **#556 — Nguồn Sự Thật + HOT STATE**: P0 cao nhất.\n2. **#478 — cơ chế tự cập nhật**: P0 an toàn kế tiếp.\n3. **#318 — PC01 tự vận hành 24/7**: phần nền tiếp tục.\n\n## HỢP ĐỒNG KHỞI ĐỘNG NHANH';
    expect(parseCentralPriorities(body)).toEqual([
      { priority: 'P0', number: 556, label: 'Nguồn Sự Thật + HOT STATE' },
      { priority: 'P0', number: 478, label: 'cơ chế tự cập nhật' },
      { priority: 'P0', number: 318, label: 'PC01 tự vận hành 24/7' },
    ]);
  });

  it('parses active and paused employees from the legacy dynamic registry table', () => {
    const body = '| `2` | `NV02` | `autonomous` | `P0` | `queue` | `Khoa (NV02 — Vận hành tự động)` | true |\n| `3` | `NV03` | `specialized` | `P0` | `local` | `Huy (NV03)` | **false — TẠM NGƯNG** |';
    const rows = parseEmployees(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ command: 2, employeeId: 'NV02', active: true });
    expect(rows[1]).toMatchObject({ command: 3, employeeId: 'NV03', active: false });
  });

  it('preserves the intermediate registry activation column', () => {
    const body = '| command | employee | mode | background | enabled | activation |\n|---|---|---|---|---|---|\n| `1` | `NV01 / Minh` | `foreground_interactive` | false | true | ACTIVE |\n| `3` | `NV03 / Huy` | `paused_specialized` | false | true | PAUSED |';
    const rows = parseEmployees(body);
    expect(rows[0]).toMatchObject({ command: 1, active: true });
    expect(rows[1]).toMatchObject({ command: 3, active: false });
  });

  it('parses Registry v12 command table shape', () => {
    const body = '| command | employee | mode | background | enabled |\n|---|---|---|---|---|\n| `1` | `NV01 / Minh` | `foreground_interactive` | false | true |\n| `3` | `NV03 / Huy` | `paused_specialized` | false | false |';
    const rows = parseEmployees(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ command: 1, employeeId: 'NV01', label: 'NV01 / Minh', active: true });
    expect(rows[1]).toMatchObject({ command: 3, employeeId: 'NV03', label: 'NV03 / Huy', active: false });
  });

  it('parses Registry v15 four-column execution status table', () => {
    const body = '| lệnh | nhân viên | chế độ | trạng thái thực thi |\n|---|---|---|---|\n| `1` | **Minh (NV01 - Kỹ sư chính / P0 & kỹ thuật)** | làm việc trực tiếp | đã kích hoạt |\n| `3` | **Huy (NV03 - Kỹ sư hệ thống dự phòng / hạ tầng)** | chuyên trách dự phòng | tạm dừng |\n| `8` | **Gemini Plus (NV08 - Chuyên gia nghiên cứu & phân tích độc lập)** | nghiên cứu thủ công | gọi được; tự động hoàn toàn chưa có cầu nối |';
    const rows = parseEmployees(body);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ command: 1, employeeId: 'NV01', active: true });
    expect(rows[1]).toMatchObject({ command: 3, employeeId: 'NV03', active: false });
    expect(rows[2]).toMatchObject({ command: 8, employeeId: 'NV08', active: true });
  });

  it('uses only explicitly declared or explicitly assigned ownership', () => {
    const body = '1. **#556 — Source Truth + HOT STATE**: highest P0. Actual executor now = `Vy / Chief of Staff`, `mode=foreground_direct`.\n2. **#478 — Zero-touch**: next safe P0.';
    expect(inferDeclaredExecutor(body, 556)).toBe('Vy / Chief of Staff');
    expect(inferDeclaredExecutor(body, 478)).toBe(null);
    const v16 = '1. **#556 — Nguồn Sự Thật + HOT STATE**: P0 cao nhất. Phần cầu nối đã giao cho **Minh (NV01 - Kỹ sư chính / P0 & kỹ thuật)** qua lệnh `1`.';
    expect(inferDeclaredExecutor(v16, 556)).toBe('Minh (NV01 - Kỹ sư chính / P0 & kỹ thuật)');
  });

  it('does not mistake descriptive owner-question prose for a real owner action', () => {
    expect(inferOwnerAction('UI phải cho biết có cần anh Sơn làm gì không.').required).toBe(false);
    expect(inferOwnerAction('STATE=CHỜ ANH SƠN').required).toBe(true);
    expect(inferOwnerAction('**STATE:** `556_DEV_GATE_PASS_MAIN_ADOPTION_OWNER_GATE`').required).toBe(true);
    expect(inferOwnerAction('MAIN/Production remain Owner-gated by policy.').required).toBe(false);
  });
});
