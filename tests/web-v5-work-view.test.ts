import { describe, expect, it } from 'vitest';
import { renderWorkContentV5, stableWorkIdV5 } from '../apps/dashboard/src/work-view-v5.js';
import type { ExecutiveDashboardV4, ExecutiveWorkV4 } from '../apps/dashboard/src/executive-data-v4.js';

function work(overrides: Partial<ExecutiveWorkV4>): ExecutiveWorkV4 {
  return {
    number: 509, title: 'Làm tab Công việc V5', ownerCode: 'NV01', owner: 'Minh (NV01)',
    progressPercent: null, progressLabel: '—', status: 'Đang làm', tone: 'active',
    next: 'Deep-link', updated: '08/09/2026 14:45:00', workId: 'GH-509', project: 'TigerIQ',
    priority: 'P0', goal: 'Execution board thật', currentStep: 'Chuẩn hóa route',
    lastActivityAt: new Date().toISOString(), evidenceRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/509',
    timeline: [{ timestamp: '2026-09-08T07:45:00.000Z', message: 'NV01 CLAIM', evidenceRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/509' }],
    ...overrides,
  };
}

function data(works: ExecutiveWorkV4[]): ExecutiveDashboardV4 {
  return { generatedAt: '2026-09-08T07:45:00.000Z', works, people: [], systems: [], activeCount: 1,
    waitingCount: 1, blockedCount: 1, doneCount: 1, pausedCount: 0, progressAverage: null,
    ownerActionRequired: false, ownerActionText: 'Không có việc cần anh Sơn' };
}
describe('Web Control V5 work execution board', () => {
  it('renders four semantic lanes from source-backed work state', () => {
    const works = [
      work({}),
      work({ number: 510, workId: 'GH-510', tone: 'waiting', status: 'Chờ xử lý', title: 'Waiting' }),
      work({ number: 511, workId: 'GH-511', tone: 'blocked', status: 'Vướng mắc', title: 'Blocked' }),
      work({ number: 512, workId: 'GH-512', tone: 'done', status: 'Hoàn tất', title: 'Done' }),
    ];
    const html = renderWorkContentV5(data(works), new URL('http://local/?view=work'));
    for (const label of ['Đang thực thi', 'Chờ', 'Bị chặn', 'Hoàn tất gần đây']) expect(html).toContain(label);
    for (const id of ['GH-509','GH-510','GH-511','GH-512']) expect(html).toContain(id);
    expect(html).not.toContain('ước lượng');
  });

  it('keeps filter context in stable work deep-links and renders verified detail', () => {
    const item = work({ workId: 'GH-509' });
    const list = renderWorkContentV5(data([item]), new URL('http://local/?view=work&owner=NV01&priority=P0'));
    expect(list).toContain('/work/GH-509?owner=NV01&amp;priority=P0');
    const detail = renderWorkContentV5(data([item]), new URL('http://local/work/GH-509?owner=NV01'), 'GH-509');
    expect(detail).toContain('Execution board thật');
    expect(detail).toContain('Chuẩn hóa route');
    expect(detail).toContain('Timeline / evidence');
    expect(stableWorkIdV5(item)).toBe('GH-509');
  });
});