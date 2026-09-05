import { describe, expect, it } from 'vitest';
// @ts-expect-error Vercel API module is JavaScript and intentionally has no declaration file.
import { projectCentralLanes, projectProgress } from '../api/company-progress.mjs';

function pull(title = 'WO-031: Mobile Workforce Board') {
  return { title, body: '', number: 93, head: { sha: 'abc', ref: 'wo031/test' } };
}

function run(name: string, status = 'completed', conclusion = 'success') {
  return { name, status, conclusion, updated_at: '2026-08-31T00:00:00.000Z' };
}

describe('company progress calculation', () => {
  it('keeps independent review as an explicit pending gate', () => {
    const result = projectProgress({
      pull: pull(),
      runs: [run('CI'), run('WO-014 Queue Hygiene'), run('WO-012/013 Vercel Online Verify')],
    });
    expect(result.progressPct).toBe(67);
    expect(result.gates.map((gate: { status: string }) => gate.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pending', 'pending']);
    expect(result.currentStep).toBe('Chờ rà soát độc lập');
    expect(result.statusLabel).toBe('CHỜ');
  });

  it('shows a failed gate as current work instead of inflating progress', () => {
    const result = projectProgress({
      pull: pull(),
      runs: [run('CI', 'completed', 'failure'), run('WO-014 Queue Hygiene')],
    });
    expect(result.progressPct).toBe(33);
    expect(result.currentStep).toContain('Đang xử lý blocker');
    expect(result.statusLabel).toBe('BỊ CHẶN');
  });

  it('adds the Android Worker build gate only when the work requires Android', () => {
    const result = projectProgress({
      pull: pull('WO-030: Android secure controller client'),
      runs: [run('CI'), run('WO-014 Queue Hygiene'), run('WO-012/013 Vercel Online Verify'), run('Android Worker')],
    });
    expect(result.gates.some((gate: { name: string }) => gate.name === 'Android Worker')).toBe(true);
    expect(result.progressPct).toBe(71);
  });

  it('does not mark a CENTRAL lane complete when its text says one sub-check passed but work remains', () => {
    const centralBody = `## P0 hiện hành\n### #334 — Generic command router\nBootstrap 2.2 đã áp dụng; NEW CHAT 2 ĐẠT. Còn genuine 1, chuỗi 3-test và ownership acceptance.\n### #335 — Registry\nAuthority động ĐANG XỬ LÝ.`;
    const lanes = projectCentralLanes({ centralBody });
    expect(lanes.find((lane: { number: number }) => lane.number === 334)?.status).toBe('pending');
    expect(lanes.find((lane: { number: number }) => lane.number === 334)?.statusLabel).toBe('CHỜ');
    expect(lanes.find((lane: { number: number }) => lane.number === 335)?.status).toBe('running');
  });
});
