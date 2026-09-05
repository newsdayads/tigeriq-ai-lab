import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderExecutiveOverviewV4, themeFunctionalPageV4, WEB_LOCAL_VERSION_V17 } from '../apps/dashboard/src/server-v17.js';
import type { ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';

const data: ExecutiveDashboardV4 = {
  generatedAt: '2026-09-05T00:00:00.000Z',
  works: [
    { number: 396, title: 'Làm lại Web Local Executive', ownerCode: 'NV01', owner: 'Minh (NV01)', progressPercent: null, progressLabel: '—', status: 'Đang làm', tone: 'active', next: 'Kiểm evidence máy thật', updated: '05/09/2026 12:00:00' },
    { number: 306, title: 'Auto Worker', ownerCode: 'NV02', owner: 'Khoa (NV02)', progressPercent: 80, progressLabel: '80%', status: 'Đang làm', tone: 'active', next: 'Physical acceptance', updated: '05/09/2026 12:00:00' },
    { number: 318, title: 'PC01', ownerCode: 'NV03', owner: 'Huy (NV03)', progressPercent: null, progressLabel: '—', status: 'Tạm ngưng', tone: 'paused', next: 'Chờ chỉ đạo', updated: '05/09/2026 12:00:00' },
    { number: 392, title: 'AI/API', ownerCode: 'NV04', owner: 'Khải (NV04)', progressPercent: null, progressLabel: '—', status: 'Chờ xử lý', tone: 'waiting', next: 'Tiếp tục adapter', updated: '05/09/2026 12:00:00' },
  ],
  people: [
    { key: 'VY', initials: 'VY', name: 'Vy (Trợ lý)', role: 'Điều phối', status: 'Điều phối', tone: 'active', current: 'Hỗ trợ vận hành dự án', activeCount: 0 },
    { key: 'NV01', initials: 'MI', name: 'Minh (NV01)', role: 'Thực thi trực tiếp', status: 'Đang làm', tone: 'active', current: 'Web Local', activeCount: 1 },
    { key: 'NV02', initials: 'KH', name: 'Khoa (NV02)', role: 'Vận hành tự động', status: 'Đang làm', tone: 'active', current: 'Auto Worker', activeCount: 1 },
    { key: 'NV03', initials: 'HU', name: 'Huy (NV03)', role: 'Kỹ sư Hệ thống Local', status: 'Tạm ngưng', tone: 'paused', current: 'PC01', activeCount: 0 },
    { key: 'NV04', initials: 'K', name: 'Khải (NV04)', role: 'Kỹ sư Tích hợp AI/API', status: 'Chờ xử lý', tone: 'waiting', current: 'AI/API', activeCount: 0 },
  ],
  systems: [
    { key: 'pc01', name: 'PC01 Server', status: 'Hoạt động', tone: 'active', note: 'CPU 32% · RAM 48%' },
    { key: 'control', name: 'Control Plane', status: 'Hoạt động', tone: 'active', note: 'Cổng 8790 phản hồi' },
    { key: 'web', name: 'Web Local', status: 'Hoạt động', tone: 'active', note: 'Renderer hiện hành' },
    { key: 'worker', name: 'Auto Worker', status: 'Chưa xác minh', tone: 'unknown', note: 'Chưa xác minh Worker' },
  ],
  activeCount: 2,
  waitingCount: 1,
  blockedCount: 0,
  doneCount: 0,
  pausedCount: 1,
  progressAverage: 80,
  ownerActionRequired: false,
  ownerActionText: 'Không có việc cần anh Sơn',
};

describe('Web Local #396 Executive V4 renderer', () => {
  it('matches the approved executive reference hierarchy and keeps real-data semantics', () => {
    const html = renderExecutiveOverviewV4(data);
    expect(html).toContain(WEB_LOCAL_VERSION_V17);
    expect(html).toContain('data-layout="executive-reference-1648x928"');
    expect(html).toContain('data-font="segoe-ui"');
    for (const label of ['Tổng quan', 'Công việc', 'Dự án', 'Nhân sự', 'Hệ thống', 'Báo cáo', 'Cài đặt']) expect(html).toContain(`>${label}<`);
    for (const module of ['Đang làm', 'Ai phụ trách', 'Tiến độ', 'Vướng mắc', 'Cần anh Sơn', 'Công việc đang chạy', 'Phân bổ công việc', 'Tải theo nhân sự', 'Trạng thái hệ thống', 'Đội AI']) expect(html).toContain(module);
    expect(html).toContain('Minh (NV01)');
    expect(html).toContain('Huy (NV03)');
    expect(html).toContain('80%');
    expect(html).toContain('—');
    expect(html).not.toContain('68%');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('Open Sans');
    expect(html).not.toContain('font-family:Inter');
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it('renders exactly seven primary navigation items while preserving evidence as a secondary route', () => {
    const html = renderExecutiveOverviewV4(data);
    const nav = html.match(/<nav class="x-nav">([\s\S]*?)<\/nav>/)?.[1] ?? '';
    expect((nav.match(/href="\/\?view=/g) ?? []).length).toBe(7);
    for (const route of ['overview', 'work', 'models', 'workforce', 'system', 'reports', 'settings']) expect(nav).toContain(`href="/?view=${route}"`);
    expect(nav).not.toContain('href="/?view=evidence"');
    expect(html).toContain('href="/?view=evidence"');
  });

  it('themes functional pages without deleting their forms, sections or actions', () => {
    const stable = '<!doctype html><html><head></head><body class="tq-view-system"><div class="shell"><aside class="sidebar"><a class="brand"><span>old</span></a><nav class="nav"><a href="/?view=overview"><span>Tổng quan</span></a><a href="/?view=work"><span>Công việc</span></a><a href="/?view=workforce"><span>Đội AI</span></a><a href="/?view=models"><span>Mô hình AI</span></a><a href="/?view=evidence"><span>Bằng chứng</span></a><a href="/?view=reports"><span>Báo cáo</span></a><a href="/?view=system"><span>Hệ thống</span></a><a href="/?view=settings"><span>Cài đặt</span></a></nav></aside><main class="content"><header class="top"><h1>Hệ thống</h1></header><section class="panel" id="he-thong"><form action="/system-action" method="post"><button>Kiểm tra PC01</button></form></section></main></div></body></html>';
    const html = themeFunctionalPageV4(stable, 'system');
    expect(html).toContain('data-layout="executive-functional-v4"');
    expect(html).toContain('id="he-thong"');
    expect(html).toContain('action="/system-action"');
    expect(html).toContain('Kiểm tra PC01');
    expect(html).toContain('href="/?view=evidence"');
    expect(html).toContain('>Bằng chứng<');
    expect(html).not.toContain('x-live-script');
  });

  it('uses V17 directly over V12 and removes V13/V14/V15 from the final runtime chain', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    expect(standalone).toContain("import { startOwnerCockpitV17 } from './server-v17.js';");
    expect(standalone).toContain("const server = await startOwnerCockpitV17({ stableUrl: cockpitV12.url");
    expect(standalone).toContain('WEB-LOCAL-396-V4.0');
    expect(standalone).not.toContain('startOwnerCockpitV13');
    expect(standalone).not.toContain('startOwnerCockpitV14');
    expect(standalone).not.toContain('startOwnerCockpitV15');
  });
});
