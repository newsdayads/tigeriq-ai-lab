import { describe, expect, it } from 'vitest';
import { renderExecutiveOverviewV4 } from '../apps/dashboard/src/server-v17.js';
import type { ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';

const data: ExecutiveDashboardV4 = {
  generatedAt: '2026-09-09T09:00:00Z',
  works: [],
  people: [],
  systems: [],
  activeCount: 1,
  waitingCount: 0,
  blockedCount: 0,
  doneCount: 0,
  pausedCount: 0,
  progressAverage: null,
  ownerActionRequired: false,
  ownerActionText: 'Không',
};

describe('current Web V5 Overview integration', () => {
  it('renders recent/next/since signals and checkpoint on the current release-channel server', () => {
    const html = renderExecutiveOverviewV4(data);
    expect(html).toContain('Vừa xảy ra');
    expect(html).toContain('Sắp làm gì');
    expect(html).toContain('Từ lần xem trước');
    expect(html).toContain('mv5-checkpoint');
  });
});
