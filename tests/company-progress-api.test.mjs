import { describe, expect, it } from 'vitest';
import { buildCompanyProgress, inferDeclaredExecutor, inferOwnerAction, parseCentralPriorities, parseEmployees, projectProgress } from '../api/company-progress.mjs';

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
    expect(result.gates.map((gate) => gate.status)).toEqual(['ĐẠT', 'ĐẠT', 'ĐẠT', 'ĐẠT', 'ĐANG CHỜ']);
    expect(result.currentStep).toContain('chuẩn bị merge/Production');
    expect(result.currentStep).not.toContain('PASS');
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

  it('#4441 parses CURRENT_EXECUTABLE_P1_P5 from the newest authoritative override block', () => {
    const body = [
      '## CURRENT OVERRIDE — NV02 FULL REPO AUDIT/FIX/CLEANUP — AUTHORITATIVE',
      'MASTER=#4409 - [P1][REPO][AUDIT] Rà toàn bộ mã nguồn TigerIQ',
      'PRIORITY=P1',
      'CURRENT_EXECUTABLE_P1_P5=#4409',
      '',
      '## OLD HISTORY',
      '### 1. P0 #111 — stale legacy item',
    ].join('\n');
    expect(parseCentralPriorities(body)).toEqual([
      { priority: 'P1', number: 4409, label: 'Rà toàn bộ mã nguồn TigerIQ' },
    ]);
  });

  it('#4441 treats authoritative CURRENT_EXECUTABLE_P1_P5=NONE as terminal over stale history', () => {
    const body = [
      '## CURRENT OVERRIDE — QUEUE RECONCILIATION — AUTHORITATIVE',
      'CURRENT_EXECUTABLE_P1_P5=NONE',
      '',
      '## OLD HISTORY',
      '### 1. P0 #111 — stale legacy item',
    ].join('\n');
    expect(parseCentralPriorities(body)).toEqual([]);
  });



  it('#4437 strips all consecutive leading canonical title prefixes only', () => {
    const rows = parseCentralPriorities('### 1. P1 #4437 — [P2][COMPANY PROGRESS][REPO AUDIT] Chuẩn hóa [giữ nguyên] title');
    expect(rows).toEqual([
      { priority: 'P1', number: 4437, label: 'Chuẩn hóa [giữ nguyên] title' },
    ]);
  });
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

  it('#4445 parses the current three-column NVxx registry schema', () => {
    const body = [
      '| mã | tên chuẩn | trạng thái quản trị |',
      '|---|---|---|',
      '| `NV00` | Vy (Trợ lý) | `CHIEF_OF_STAFF / PRIMARY_UI / OWNER_INTERFACE` |',
      '| `NV02` | ChatGPT Plus | `AVAILABLE_MANUAL / PRIMARY_UI_EXECUTOR` |',
      '| `NV10` | Ollama | `ACTIVE_CORE_RESOURCE / LOCAL_AI / ZERO_TOKEN_LOCAL` |',
      '| `NV01` | MacroDroid Z Flip | `OWNER_STOPPED / DO_NOT_ROUTE` |',
    ].join('\n');
    const rows = parseEmployees(body);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ command: 0, employeeId: 'NV00', label: 'Vy (Trợ lý)', active: true, state: 'Hoạt động trong phạm vi được phép' });
    expect(rows[1]).toMatchObject({ command: 2, employeeId: 'NV02', label: 'ChatGPT Plus', active: true, state: 'Dùng thủ công' });
    expect(rows[2]).toMatchObject({ command: 10, employeeId: 'NV10', label: 'Ollama', active: true, state: 'Hoạt động trong phạm vi được phép' });
    expect(rows[3]).toMatchObject({ command: 1, employeeId: 'NV01', label: 'MacroDroid Z Flip', active: false, state: 'Tạm dừng' });
  });

  it('parses active and paused employees from the dynamic registry table', () => {
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

  it('#4443 reads TARGET_EMPLOYEE from the same CURRENT_EXECUTABLE override block', () => {
    const body = [
      '## CURRENT OVERRIDE — AUTHORITATIVE',
      'MASTER=#4409 - [P1][REPO][AUDIT] Rà toàn bộ mã nguồn TigerIQ',
      'TARGET_EMPLOYEE=NV02',
      'CURRENT_EXECUTABLE_P1_P5=#4409',
      '',
      '## OLD HISTORY',
      'TARGET_EMPLOYEE=NV99',
      'CURRENT_EXECUTABLE_P1_P5=#1234',
    ].join('\n');
    expect(inferDeclaredExecutor(body, 4409)).toBe('NV02');
    expect(inferDeclaredExecutor(body, 1234)).toBe('NV99');
    expect(inferDeclaredExecutor(body, 9999)).toBe(null);
  });

  it('uses only an explicitly declared executor for current work ownership', () => {
    const body = '1. **#556 — Source Truth + HOT STATE**: highest P0. Actual executor now = `Vy / Chief of Staff`, `mode=foreground_direct`.\n2. **#478 — Zero-touch**: next safe P0.';
    expect(inferDeclaredExecutor(body, 556)).toBe('Vy / Chief of Staff');
    expect(inferDeclaredExecutor(body, 478)).toBe(null);
    expect(inferDeclaredExecutor(body, 999)).toBe(null);
  });

  it('does not mistake descriptive owner-question prose for a real owner action', () => {
    expect(inferOwnerAction('UI phải cho biết có cần anh Sơn làm gì không.').required).toBe(false);
    expect(inferOwnerAction('STATE=CHỜ ANH SƠN').required).toBe(true);
    expect(inferOwnerAction('**STATE:** `556_DEV_GATE_PASS_MAIN_ADOPTION_OWNER_GATE`').required).toBe(true);
    expect(inferOwnerAction('MAIN/Production remain Owner-gated by policy.').required).toBe(false);
  });
});

describe('CENTRAL v16 + Registry v15 compatibility', () => {
  it('parses Vietnamese current priority section', () => {
    const body = '## ƯU TIÊN HIỆN HÀNH — 2026-09-10\n1. **#556 — Nguồn Sự Thật + HOT STATE**: P0 cao nhất.\n2. **#478 — cơ chế tự cập nhật toàn hệ thống**: P0 an toàn kế tiếp.\n\n## HỢP ĐỒNG KHỞI ĐỘNG NHANH';
    expect(parseCentralPriorities(body)).toEqual([
      { priority: 'P0', number: 556, label: 'Nguồn Sự Thật + HOT STATE' },
      { priority: 'P0', number: 478, label: 'cơ chế tự cập nhật toàn hệ thống' },
    ]);
  });

  it('parses four-column Vietnamese registry states', () => {
    const body = '| lệnh | nhân viên | chế độ | trạng thái thực thi |\n|---|---|---|---|\n| 1 | **Minh (NV01 - Kỹ sư chính / P0 & kỹ thuật)** | làm việc trực tiếp | đã kích hoạt |\n| 3 | **Huy (NV03 - Kỹ sư hệ thống dự phòng / hạ tầng)** | chuyên trách dự phòng | tạm dừng |\n| 8 | **Gemini Plus (NV08 - Chuyên gia nghiên cứu & phân tích độc lập)** | nghiên cứu thủ công | gọi được; tự động hoàn toàn chưa có cầu nối |';
    const rows = parseEmployees(body);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ command: 1, employeeId: 'NV01', active: true, state: 'Đã kích hoạt' });
    expect(rows[1]).toMatchObject({ command: 3, employeeId: 'NV03', active: false, state: 'Tạm dừng' });
    expect(rows[2]).toMatchObject({ command: 8, employeeId: 'NV08', active: true, state: 'Dùng thủ công' });
  });
});


describe('#4433 company progress priority fetch concurrency', () => {
  it('starts independent issue reads concurrently while preserving CENTRAL order and per-item fallback', async () => {
    const centralBody = [
      '### 1. P1 #101 — First',
      '### 2. P2 #102 — Second',
      '### 3. P2 #103 — Missing',
    ].join('\n');
    let resolveFirst;
    let secondStarted = false;
    const delayedFirst = new Promise((resolve) => { resolveFirst = resolve; });
    const response = (body) => ({ ok: true, status: 200, json: async () => body });
    const fetchImpl = async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/issues/280')) return response({ body: centralBody, updated_at: '2026-10-07T00:00:00Z' });
      if (path.endsWith('/issues/335')) return response({ body: '', updated_at: '2026-10-07T00:00:00Z' });
      if (path.endsWith('/issues/101')) return delayedFirst;
      if (path.endsWith('/issues/102')) {
        secondStarted = true;
        return response({ title: 'Second live', state: 'closed', updated_at: '2026-10-07T00:02:00Z', html_url: 'https://example.test/102' });
      }
      if (path.endsWith('/issues/103')) throw new Error('synthetic_unavailable');
      throw new Error('unexpected_fetch:' + path);
    };

    const projection = buildCompanyProgress(fetchImpl);
    await new Promise((resolve) => setImmediate(resolve));
    expect(secondStarted).toBe(true);

    resolveFirst(response({ title: 'First live', state: 'closed', updated_at: '2026-10-07T00:01:00Z', html_url: 'https://example.test/101' }));
    const result = await projection;

    expect(result.priorityIssues.map((row) => row.number)).toEqual([101, 102, 103]);
    expect(result.priorityIssues[0]).toMatchObject({ title: 'First live', status: 'HOÀN TẤT', open: false });
    expect(result.priorityIssues[1]).toMatchObject({ title: 'Second live', status: 'HOÀN TẤT', open: false });
    expect(result.priorityIssues[2]).toMatchObject({ title: 'Missing', status: 'CHƯA XÁC MINH', open: null });
  });
});


describe('#4435 company progress latest activity', () => {
  it('requests issue comments newest-first and exposes the latest six in that order', async () => {
    const centralBody = '### 1. P1 #101 — Active';
    let commentsRequest = '';
    const response = (body) => ({ ok: true, status: 200, json: async () => body });
    const newest = Array.from({ length: 8 }, (_, index) => ({
      body: `update-${8 - index}`,
      created_at: `2026-10-07T00:0${8 - index}:00Z`,
      html_url: `https://example.test/c/${8 - index}`,
    }));
    const fetchImpl = async (url) => {
      const parsed = new URL(String(url));
      const path = parsed.pathname;
      if (path.endsWith('/issues/280')) return response({ body: centralBody, updated_at: '2026-10-07T00:00:00Z' });
      if (path.endsWith('/issues/335')) return response({ body: '', updated_at: '2026-10-07T00:00:00Z' });
      if (path.endsWith('/issues/101/comments')) {
        commentsRequest = parsed.search;
        return response(newest);
      }
      if (path.endsWith('/issues/101')) return response({ title: 'Active live', state: 'open', body: '', updated_at: '2026-10-07T00:01:00Z', html_url: 'https://example.test/101' });
      throw new Error('unexpected_fetch:' + parsed.pathname + parsed.search);
    };

    const result = await buildCompanyProgress(fetchImpl);
    expect(commentsRequest).toContain('per_page=8');
    expect(commentsRequest).toContain('sort=created');
    expect(commentsRequest).toContain('direction=desc');
    expect(result.activity.map((row) => row.name)).toEqual(['update-8', 'update-7', 'update-6', 'update-5', 'update-4', 'update-3']);
  });
});
