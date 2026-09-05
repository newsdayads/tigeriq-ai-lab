import { describe, expect, it } from 'vitest';
import { buildCompanyProgress, projectProgress } from '../api/company-progress.mjs';

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
    expect(result.currentStep).toContain('chuẩn bị hợp nhất/xuất bản');
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

function issue(number, title, body, updated = '2026-09-05T05:20:00.000Z', state = 'open') {
  return { number, title, body, updated_at: updated, state, html_url: `https://github.com/newsdayads/tigeriq-ai-lab/issues/${number}` };
}

function authoritativeFetch(url) {
  const number = Number(String(url).match(/\/issues\/(\d+)$/)?.[1]);
  const rows = {
    280: issue(280, '[CENTRAL] queue', 'Chỉ **Khoa (NV02 — Vận hành tự động)** tiếp tục tự chạy. State: `UNATTENDED_ONLY_NV02_P0_368_THEN_423`'),
    335: issue(335, '[REGISTRY] Dynamic Command', [
      '- `NV01`: **Minh** — `Thực thi trực tiếp`; active=true',
      '- `NV02`: **Khoa** — `Vận hành tự động`; active=true',
      '- `NV03`: **Huy** — `AI PC01 / Kỹ sư Hệ thống Local`; active=false (TẠM NGƯNG)',
      '- `NV04`: **Khải** — `Kỹ sư Tích hợp AI/API`; active=true',
    ].join('\n')),
    368: issue(368, '[P0][NV02] Watchdog hidden console', 'State: `TECHNICAL_LIVE_PASS_PHYSICAL_PENDING`'),
    423: issue(423, '[P0][NV02] Public Vercel View', 'State: `NV02_UNATTENDED_WEB_VIEW`'),
    401: issue(401, '[P0] Tự vận hành', 'State: `BLOCKED_NOT_IDLE`'),
    306: issue(306, '[P0] Auto Worker', 'State: `NO_REWORK`'),
  };
  return Promise.resolve({ ok: Boolean(rows[number]), status: rows[number] ? 200 : 404, json: async () => rows[number] });
}

describe('authoritative public management projection', () => {
  it('uses CENTRAL #280 and Registry #335 instead of selecting an arbitrary WO pull request', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return authoritativeFetch(url);
    };
    const result = await buildCompanyProgress(fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('authoritative-read-only');
    expect(result.source.centralIssue).toBe(280);
    expect(result.source.registryIssue).toBe(335);
    expect(result.management.owner).toContain('Khoa (NV02');
    expect(result.management.doing).toContain('#368 → #423');
    expect(result.workforce.map((employee) => employee.name)).toEqual(['Vy', 'Minh', 'Khoa', 'Huy', 'Khải']);
    expect(result.workforce.find((employee) => employee.id === 'NV02')?.status).toBe('Đang vận hành');
    expect(result.initiatives.map((item) => item.number)).toEqual([368, 423, 401, 306]);
    expect(calls.some((url) => url.includes('/pulls?'))).toBe(false);
  });

  it('does not expose raw authoritative issue bodies in the public response', async () => {
    const result = await buildCompanyProgress(authoritativeFetch);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('active=false (TẠM NGƯNG)');
    expect(serialized).not.toContain('UNATTENDED_ONLY_NV02_P0_368_THEN_423');
    expect(result.source.state).toBe('UNATTENDED_ONLY_NV02_P0_368_THEN_423');
  });
});
