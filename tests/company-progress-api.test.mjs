import { describe, expect, it } from 'vitest';
import { projectProgress } from '../api/company-progress.mjs';

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
      runs: [
        run('CI'),
        run('WO-014 Queue Hygiene'),
        run('WO-012/013 Vercel Online Verify'),
      ],
    });
    expect(result.progressPct).toBe(80);
    expect(result.gates.map((gate) => gate.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pending']);
    expect(result.currentStep).toContain('chuẩn bị merge/Production');
  });

  it('shows a failed gate as current work instead of inflating progress', () => {
    const result = projectProgress({
      pull: pull(),
      runs: [
        run('CI', 'completed', 'failure'),
        run('WO-014 Queue Hygiene'),
      ],
    });
    expect(result.progressPct).toBe(40);
    expect(result.currentStep).toContain('Đang sửa lỗi');
  });

  it('adds the Android Worker build gate only when the work requires Android', () => {
    const result = projectProgress({
      pull: pull('WO-030: Android secure controller client'),
      runs: [
        run('CI'),
        run('WO-014 Queue Hygiene'),
        run('WO-012/013 Vercel Online Verify'),
        run('Android Worker'),
      ],
    });
    expect(result.gates.some((gate) => gate.name === 'Android Worker')).toBe(true);
    expect(result.progressPct).toBe(83);
  });
});
