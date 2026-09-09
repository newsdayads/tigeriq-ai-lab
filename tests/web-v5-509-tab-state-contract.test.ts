import { describe, expect, it } from 'vitest';
import type { ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';
import { renderSystemContentV5, renderWorkforceContentV5 } from '../apps/dashboard/src/entity-views-v5.js';
import { renderProjectsV5, renderReportsV5, renderSettingsV5 } from '../apps/dashboard/src/management-views-v5.js';

function data(sourceStatus: string, sourceNote: string): ExecutiveDashboardV4 {
  return {
    generatedAt: '2026-09-09T18:00:00Z',
    works: [],
    people: [],
    systems: [],
    activeCount: 0,
    waitingCount: 0,
    blockedCount: 0,
    doneCount: 0,
    pausedCount: 0,
    progressAverage: null,
    ownerActionRequired: false,
    ownerActionText: 'Không',
    sourceStatus,
    sourceNote,
  };
}

const states = [
  ['Đang tải', 'Đang đồng bộ dữ liệu hiện hành'],
  ['Lỗi nguồn', 'Không thể xác minh nguồn dữ liệu hiện hành'],
  ['Mất tín hiệu', 'Dữ liệu đã quá ngưỡng freshness'],
  ['Nguồn trực tiếp', 'Dữ liệu hiện hành đã sẵn sàng'],
] as const;

describe('#509 tab-specific presentation states', () => {
  for (const [status, note] of states) {
    it(`propagates ${status} truth across Project/People/System/Reports/Settings`, () => {
      const d = data(status, note);
      const views = [
        renderProjectsV5(d),
        renderWorkforceContentV5(d),
        renderSystemContentV5(d),
        renderReportsV5(d),
        renderSettingsV5(d),
      ];

      for (const html of views) {
        expect(html).toContain(status);
        expect(html).toContain(note);
        expect(html).not.toContain('100%');
      }
    });
  }

  it('keeps empty states explicit instead of inventing entities or metrics', () => {
    const d = data('Nguồn trực tiếp', 'Dữ liệu hiện hành đã sẵn sàng');
    expect(renderProjectsV5(d)).toContain('Chưa có dự án được liên kết.');
    expect(renderReportsV5(d)).toContain('Chưa có sự kiện mới được xác minh.');
    expect(renderReportsV5(d)).toContain('Không có công việc bị chặn hoặc mất tín hiệu.');
    expect(renderWorkforceContentV5(d)).not.toContain('/people/');
    expect(renderSystemContentV5(d)).not.toContain('/system/');
  });
});
