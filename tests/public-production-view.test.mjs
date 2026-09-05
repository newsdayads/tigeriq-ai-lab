import { describe, expect, it } from 'vitest';
import { verifyProgress, verifyRoot } from '../scripts/verify-public-production-view.mjs';

const goodRoot = `
<title>TigerIQ · Bảng điều hành</title>
<p>View quản trị chỉ xem · Internet công cộng · không cần VPN</p>
<div>CHỈ XEM</div><div>Cần anh Sơn</div>`;

const goodProgress = {
  ok: true,
  mode: 'authoritative-central-registry',
  source: { centralIssue: 280, registryIssue: 335 },
  activeWork: { number: 423 },
  priorityIssues: [{ number: 423 }],
  employees: [{ command: 2, employeeId: 'NV02', active: true, label: 'Khoa (NV02 — Vận hành tự động)' }],
};

describe('public Production read-only verifier', () => {
  it('accepts the intended #423 read-only contract', () => {
    expect(verifyRoot(goodRoot)).toEqual([]);
    expect(verifyProgress(goodProgress, { expectedIssue: 423 })).toEqual([]);
  });

  it('rejects legacy write surfaces', () => {
    const errors = verifyRoot(`${goodRoot}<section>Giao việc cho Vy</section><textarea id="instruction"></textarea>`);
    expect(errors).toContain('forbidden_root_marker:Giao việc cho Vy');
    expect(errors).toContain('forbidden_root_marker:id="instruction"');
  });

  it('rejects stale PR-derived projection mode', () => {
    const errors = verifyProgress({ ...goodProgress, mode: 'evidence-based' }, { expectedIssue: 423 });
    expect(errors).toContain('progress_mode_not_authoritative');
  });

  it('rejects wrong sources or inactive NV02', () => {
    const errors = verifyProgress({
      ...goodProgress,
      source: { centralIssue: 1, registryIssue: 2 },
      employees: [{ command: 2, employeeId: 'NV02', active: false }],
    }, { expectedIssue: 423 });
    expect(errors).toContain('central_source_mismatch');
    expect(errors).toContain('registry_source_mismatch');
    expect(errors).toContain('nv02_projection_missing_or_inactive');
  });

  it('binds acceptance to the requested issue when provided', () => {
    const errors = verifyProgress({ ...goodProgress, activeWork: { number: 401 }, priorityIssues: [{ number: 401 }] }, { expectedIssue: 423 });
    expect(errors).toContain('expected_issue_missing:423');
  });
});
