import { describe, expect, it } from 'vitest';
import type { ExecutiveDashboardV4, ExecutiveWorkV4 } from '../apps/dashboard/src/executive-data-v4.js';
import { renderSystemContentV5, renderWorkforceContentV5 } from '../apps/dashboard/src/entity-views-v5.js';
import { renderProjectsV5, renderReportsV5 } from '../apps/dashboard/src/management-views-v5.js';
import { renderWorkContentV5 } from '../apps/dashboard/src/work-view-v5.js';

const work: ExecutiveWorkV4 = {
  number: 509,
  title: 'Web V5 IA',
  ownerCode: 'NV01',
  owner: 'Minh (NV01)',
  progressPercent: null,
  progressLabel: '—',
  status: 'Có thể đang treo',
  tone: 'stale',
  next: 'Retest',
  updated: '09/09/2026',
  workId: 'GH-509',
  projectId: 'project:tigeriq',
  project: 'TigerIQ',
  priority: 'P0',
  goal: 'Web Control V5 có chức năng thật',
  currentStep: 'Harden IA contract',
  updatedAt: '2026-09-09T10:00:00Z',
  lastActivityAt: '2026-09-09T10:00:00Z',
};

function data(): ExecutiveDashboardV4 {
  return {
    generatedAt: '2026-09-09T10:00:00Z',
    works: [work],
    people: [{ key: 'NV01', initials: 'MI', name: 'Minh (NV01)', role: 'Web UI', status: 'Đang làm', tone: 'active', current: 'GH-509', activeCount: 1 }],
    systems: [{ key: 'command-center', name: 'Command Center', status: 'Chưa xác minh', tone: 'unknown', note: 'Chưa có nguồn trực tiếp' }],
    activeCount: 0,
    waitingCount: 1,
    blockedCount: 0,
    doneCount: 0,
    pausedCount: 1,
    progressAverage: null,
    ownerActionRequired: false,
    ownerActionText: 'Không',
    sourceStatus: 'Lỗi nguồn',
    sourceNote: 'Không thể xác minh nguồn dữ liệu hiện hành',
  };
}

describe('#509 Web V5 IA contract', () => {
  it('keeps work filter context through detail and back navigation', () => {
    const url = new URL('http://local/?view=work&q=web&owner=NV01&priority=P0&stale=1');
    const list = renderWorkContentV5(data(), url);
    expect(list).toContain('/work/GH-509?q=web&amp;owner=NV01&amp;priority=P0&amp;stale=1');
    expect(list).toContain('name="stale" value="1" checked');
    expect(list).toContain('Có thể đang treo');

    const detail = renderWorkContentV5(data(), url, 'GH-509');
    expect(detail).toContain('/?view=work&q=web&owner=NV01&priority=P0&stale=1');
  });

  it('renders explicit source error/stale truth instead of inventing progress', () => {
    const d = data();
    const views = [
      renderWorkContentV5(d, new URL('http://local/?view=work')),
      renderProjectsV5(d),
      renderReportsV5(d),
      renderWorkforceContentV5(d),
      renderSystemContentV5(d),
    ];
    for (const html of views) {
      expect(html).toContain('Lỗi nguồn');
      expect(html).toContain('Không thể xác minh nguồn dữ liệu hiện hành');
      expect(html).not.toContain('100%');
    }
  });

  it('keeps stable-id drill-down links across project, people, system and work surfaces', () => {
    const d = data();
    const project = renderProjectsV5(d, 'project:tigeriq');
    const people = renderWorkforceContentV5(d, 'NV01');
    const systems = renderSystemContentV5(d);
    const workList = renderWorkContentV5(d, new URL('http://local/?view=work'));

    expect(project).toContain('/work/GH-509');
    expect(people).toContain('/work/GH-509');
    expect(systems).toContain('/system/command-center');
    expect(workList).toContain('/work/GH-509');
  });
});
