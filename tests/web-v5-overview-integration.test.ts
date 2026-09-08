import { describe, expect, it } from 'vitest';
import { renderExecutiveOverviewV4 } from '../apps/dashboard/src/server-v17.js';
import type { ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';

const data: ExecutiveDashboardV4 = {
  generatedAt: '2026-09-08T08:00:00Z',
  works: [],
  people: [],
  systems: [],
  activeCount: 1,
  waitingCount: 2,
  blockedCount: 3,
  doneCount: 4,
  pausedCount: 0,
  progressAverage: null,
  ownerActionRequired: false,
  ownerActionText: 'Không',
};

describe('Web V5 Overview integration', () => {
  it('renders the live recent/next/since signals on the real Overview route', () => {
    const html = renderExecutiveOverviewV4(data);
    expect(html).toContain('Vừa xảy ra');
    expect(html).toContain('Sắp làm gì');
    expect(html).toContain('Từ lần xem trước');
    expect(html).toContain('mv5-checkpoint');
  });
});
