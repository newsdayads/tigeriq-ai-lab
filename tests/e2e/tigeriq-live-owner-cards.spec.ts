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
  await expect(page.locator('.owner-clean-board')).toBeVisible();
}

test('shows only the owner-readable work package and five-stage live flow on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  await expect(page.locator('#ownerSummary')).toBeHidden();
  await expect(page.locator('.owner-clean-stage')).toHaveCount(5);
  await expect(page.locator('.owner-clean-flow')).toContainText('Giao việc');
  await expect(page.locator('.owner-clean-flow')).toContainText('Điều phối');
  await expect(page.locator('.owner-clean-flow')).toContainText('Thực hiện');
  await expect(page.locator('.owner-clean-flow')).toContainText('Kiểm tra');
  await expect(page.locator('.owner-clean-flow')).toContainText('Kết quả');
  await expect(page.locator('.package-task')).toHaveCount(0);
  await expect(page.locator('.package-stream')).toHaveCount(0);
});

test('keeps current/next owner-readable and moves technical evidence into the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  const current = page.locator('.owner-clean-current');
  await expect(current).toContainText('Dựng mặt thẻ công việc');
  await expect(current).toContainText('Kiểm tra browser desktop và mobile');
  await expect(page.locator('.owner-clean-board')).not.toContainText('#111');
  await expect(page.locator('.owner-clean-board')).not.toContainText('NV03');
  await expect(page.locator('.owner-clean-board')).not.toContainText('70%');

  await page.locator('.owner-clean-detail').click();
  await expect(page.locator('#workDrawer')).toHaveClass(/open/);
  await expect(page.locator('#drawerTitle')).toContainText('Xây thẻ công việc đọc là hiểu');
  await expect(page.locator('#drawerProgress')).toContainText('70%');
});

test('shows raw Work list by default', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);
  await expect(page.locator('#rawWorkDetails')).toHaveAttribute('open', '');
});

test('uses the same clean vertical flow on mobile without document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTiger(page);

  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentScroll: document.documentElement.scrollWidth,
    flowColumns: getComputedStyle(document.querySelector('.owner-clean-flow')!).gridTemplateColumns,
    rawOpen: document.querySelector('#rawWorkDetails')?.hasAttribute('open') ?? false
  }));
  expect(metrics.documentScroll).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.rawOpen).toBe(true);
  expect(metrics.flowColumns.split(' ').length).toBe(1);
  await expect(page.locator('.owner-clean-stage')).toHaveCount(5);
  await expect(page.locator('.owner-clean-detail')).toBeVisible();
});

test('keeps multiple work packages as compact pills instead of rendering all cards at once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTiger(page);

  await expect(page.locator('.owner-clean-package')).toHaveCount(9);
  await expect(page.locator('.package-tab')).toHaveCount(0);
  await expect(page.locator('.package-stream')).toHaveCount(0);
  await expect(page.locator('.package-task')).toHaveCount(0);
});


test('derives clean-flow status from evidence instead of row count', async ({ page }) => {
  await openTiger(page);
  const result = await page.evaluate(() => {
    const fn = (window as any).ownerCleanStages;
    const openRows = [{ number: 1, status: 'MỞ' }, { number: 2, status: 'ĐANG CHỜ' }];
    return fn({ rows: openRows, aggregate: { state: 'WAITING' } }, openRows[0]);
  });
  expect(result.find((stage: any) => stage.label === 'Điều phối')?.state).toBe('WAITING');
});

test('keeps owner decision at result stage after technical execution is complete', async ({ page }) => {
  await openTiger(page);
  const result = await page.evaluate(() => {
    const fn = (window as any).ownerCleanStages;
    const focus = { number: 1, status: 'CHỜ ANH SƠN DUYỆT', technicalComplete: true };
    return fn({ rows: [focus], aggregate: { state: 'OWNER_GATE' } }, focus);
  });
  expect(result.find((stage: any) => stage.label === 'Thực hiện')?.state).toBe('DONE');
  expect(result.find((stage: any) => stage.label === 'Kết quả')?.state).toBe('OWNER_GATE');
});

test('does not report final result while independent review remains open', async ({ page }) => {
  await openTiger(page);
  const result = await page.evaluate(() => {
    const fn = (window as any).ownerCleanStages;
    const focus = { number: 1, status: 'HOÀN TẤT', employeeId: 'NV03' };
    const review = { number: 2, status: 'RÀ SOÁT', reviewOnly: true, employeeId: 'NV12' };
    return fn({ rows: [focus, review], aggregate: { state: 'DONE' } }, focus);
  });
  expect(result.find((stage: any) => stage.label === 'Kiểm tra')?.state).toBe('REVIEW');
  expect(result.find((stage: any) => stage.label === 'Kết quả')?.state).toBe('WAITING');
});

test('preserves blocker warning and normalizes technical next-step text', async ({ page }) => {
  await openTiger(page);
  const result = await page.evaluate(() => {
    const shortNextFn = (window as any).shortNext;
    return {
      next: shortNextFn({ status: 'ĐANG XỬ LÝ', nextStep: '#123 -> #124' })
    };
  });
  expect(result.next).toBe('Hoàn tất chuỗi phụ thuộc');

  const aggregate = await page.evaluate(() => {
    const fn = (window as any).packageAggregate;
    return fn([
      { number: 1, status: 'ĐANG XỬ LÝ', employeeId: 'NV03' },
      { number: 2, status: 'BỊ CHẶN' }
    ]);
  });
  expect(aggregate.state).toBe('WORKING');
  expect(aggregate.label).toBe('ĐANG LÀM · CÓ VƯỚNG');
});
