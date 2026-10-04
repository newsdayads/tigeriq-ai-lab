import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';

test.use({ channel: 'chrome' });

const html = fs.readFileSync(new URL('../../command-center.html', import.meta.url), 'utf8');

const snapshot = {
  ok: true,
  liveConnected: true,
  mode: 'pc01-live',
  generatedAt: '2026-10-04T02:30:00.000Z',
  workProjection: { mode: 'verified', stale: false, verifiedAt: '2026-10-04T02:30:00.000Z' },
  completionProgress: { source: 'terminal_completion', percent: 50, completedItems: 1, scopeItems: 2 },
  openSummary: { running: 2, owner: 1, review: 1, waiting: 0, system: 0, done: 1 },
  openWork: [
    { number: 100, title: '[P1][UI] Làm giao diện TigerIQ dễ hiểu', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', currentStep: 'Điều phối giao diện thẻ', nextStep: 'Hoàn tất các nhánh' },
    { number: 110, parentNumber: 100, title: '[P1][UI] Nhánh trình bày thẻ công việc', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', currentStep: 'Tổ chức thẻ việc', nextStep: 'Gắn công việc thực thi' },
    { number: 111, parentNumber: 110, title: '[P1][UI] Xây thẻ công việc đọc là hiểu', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', employeeId: 'NV03', currentStep: 'Dựng mặt thẻ công việc', latestCompletedStep: 'Đã chốt cấu trúc card', nextStep: 'Kiểm tra browser desktop và mobile', targetPrNumber: 200, progressPercent: 70, progressSource: 'explicit_verified' },
    { number: 112, parentNumber: 111, title: '[P1][REVIEW] Kiểm tra thẻ công việc', status: 'RÀ SOÁT', workKind: 'WORK', priority: 'P1', reviewOnly: true, employeeId: 'NV12', currentStep: 'Kiểm tra card', targetPrNumber: 200 },
    { number: 113, parentNumber: 111, title: '[P1][RESULT] Xuất bản giao diện mới', status: 'CHỜ ANH SƠN DUYỆT', workKind: 'WORK', priority: 'P1', technicalComplete: true, latestCompletedStep: 'Production đã sẵn sàng', nextStep: 'Duyệt kết quả cuối', targetPrNumber: 200 },
    { number: 120, parentNumber: 100, title: '[P1][UI] Nhánh không có phần trăm xác minh', status: 'ĐANG CHỜ', workKind: 'WORK', priority: 'P1', currentStep: 'Chờ dữ liệu', nextStep: 'Xác minh tiến độ' },
    { number: 121, parentNumber: 120, title: '[P1][UI] Thẻ chưa xác minh tiến độ', status: 'ĐANG CHỜ', workKind: 'WORK', priority: 'P1', employeeId: 'NV04', currentStep: 'Chờ xác minh', nextStep: 'Bổ sung evidence' },
    ...Array.from({ length: 8 }, (_, i) => ({
      number: 300 + i,
      title: '[P2][TEST] Việc phụ '+String(i + 1).padStart(2, '0'),
      status: 'UNKNOWN',
      workKind: 'WORK',
      priority: 'P2',
      currentStep: null,
      nextStep: 'Chờ điều phối'
    }))
  ],
  activeWork: [
    { number: 111, parentNumber: 110, title: '[P1][UI] Xây thẻ công việc đọc là hiểu', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', employeeId: 'NV03', currentStep: 'Dựng mặt thẻ công việc', latestCompletedStep: 'Đã chốt cấu trúc card', nextStep: 'Kiểm tra browser desktop và mobile', targetPrNumber: 200, progressPercent: 70, progressSource: 'explicit_verified' }
  ],
  nextQueue: [],
  recentWork: [],
  workers: [
    { employeeId: 'NV03', label: 'ChatGPT Go', state: 'working', status: 'ĐANG LÀM', detail: 'Đang xử lý card giao diện', source: 'PC01 live runtime' }
  ]
};

async function openTiger(page: Page) {
  await page.route('https://tigeriq.test/**', async (route: Route) => {
    const url = route.request().url();
    if (url.endsWith('/api/live-status')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) });
      return;
    }
    if (url.endsWith('/command-center')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('https://tigeriq.test/command-center');
  await expect(page.locator('.package-shell')).toBeVisible();
}

test('restores the old Work Package cards with verified percent bars', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  await expect(page.locator('.workflow-board')).toHaveCount(0);
  await expect(page.locator('.package-stream')).toHaveCount(2);

  const task = page.locator('.package-task[data-package-row="111"]');
  await expect(task).toBeVisible();
  await expect(task).toContainText('Xây thẻ công việc đọc là hiểu');
  await expect(task).toContainText('NV03');
  await expect(task).toContainText('70%');
  await expect(task.locator('.package-task-progress-track')).toHaveAttribute('aria-valuenow', '70');
  await expect(task.locator('.package-task-progress-track i')).toHaveAttribute('style', 'width:70%');
  await expect(task).toContainText('Rà soát/evidence đã gom: 1');
  await page.screenshot({ path: 'artifacts/old-cards-desktop.png', fullPage: true });
});

test('does not invent a percentage when progress is not verified', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  const task = page.locator('.package-task[data-package-row="121"]');
  await expect(task).toBeVisible();
  await expect(task).toContainText('Thẻ chưa xác minh tiến độ');
  await expect(task).toContainText('chưa xác minh');
  await expect(task.locator('.package-task-progress-track')).not.toHaveAttribute('aria-valuenow', /.+/);
});

test('keeps old task cards readable on mobile without document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTiger(page);

  const firstTask = page.locator('.package-task').first();
  await expect(firstTask).toBeVisible();
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentScroll: document.documentElement.scrollWidth,
    streamsColumns: getComputedStyle(document.querySelector('.package-streams')!).gridTemplateColumns,
    rawOpen: document.querySelector('#rawWorkDetails')?.hasAttribute('open') ?? false
  }));
  expect(metrics.documentScroll).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.rawOpen).toBe(false);
  expect(metrics.streamsColumns.split(' ').length).toBe(1);
  await page.screenshot({ path: 'artifacts/old-cards-mobile.png', fullPage: true });
});

test('keeps package selector readable and never renders the compact six-node workflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTiger(page);

  await expect(page.locator('.package-tab')).toHaveCount(9);
  await expect(page.locator('.mobile-flow-map')).toHaveCount(0);
  await expect(page.locator('.mobile-flow-node')).toHaveCount(0);
  await expect(page.locator('.flow-package-choice')).toHaveCount(0);
  await expect(page.locator('.package-focus')).toContainText('Xây thẻ công việc đọc là hiểu');
});
