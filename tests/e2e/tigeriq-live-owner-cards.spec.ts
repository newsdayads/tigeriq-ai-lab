import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';

test.use({ channel: 'chrome' });

const html = fs.readFileSync(new URL('../../command-center.html', import.meta.url), 'utf8');

const snapshot = {
  ok: true,
  liveConnected: true,
  mode: 'pc01-live',
  generatedAt: '2026-10-04T00:00:00.000Z',
  workProjection: { mode: 'verified', stale: false, verifiedAt: '2026-10-04T00:00:00.000Z' },
  completionProgress: { source: 'terminal_completion', percent: 50, completedItems: 1, scopeItems: 2 },
  openSummary: { running: 2, owner: 1, review: 1, waiting: 0, system: 0, done: 1 },
  openWork: [
    { number: 100, title: '[P1][UI] Làm giao diện TigerIQ dễ hiểu', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', currentStep: 'Điều phối luồng công việc', nextStep: 'Hoàn tất các nhánh và kiểm tra kết quả' },
    { number: 110, parentNumber: 100, title: '[P1][UI] Nhánh trình bày thẻ công việc', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', currentStep: 'Tổ chức thông tin theo cách người dùng đọc', nextStep: 'Gắn công việc thực thi' },
    { number: 111, parentNumber: 110, title: '[P1][UI] Xây thẻ công việc đọc là hiểu', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', employeeId: 'NV03', currentStep: 'Dựng mặt thẻ hiển thị việc đang làm', latestCompletedStep: 'Đã chốt cấu trúc card', nextStep: 'Kiểm tra browser desktop và mobile', targetPrNumber: 200, progressPercent: 70, progressSource: 'explicit_verified' },
    { number: 112, parentNumber: 111, title: '[P1][REVIEW] Kiểm tra thẻ công việc', status: 'RÀ SOÁT', workKind: 'WORK', priority: 'P1', reviewOnly: true, employeeId: 'NV12', currentStep: 'Kiểm tra card và graph', targetPrNumber: 200 },
    { number: 113, parentNumber: 111, title: '[P1][RESULT] Xuất bản giao diện mới', status: 'CHỜ ANH SƠN DUYỆT', workKind: 'WORK', priority: 'P1', technicalComplete: true, latestCompletedStep: 'Production đã sẵn sàng', nextStep: 'Duyệt kết quả cuối', targetPrNumber: 200 },
    ...Array.from({ length: 12 }, (_, i) => ({
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
    { number: 111, parentNumber: 110, title: '[P1][UI] Xây thẻ công việc đọc là hiểu', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', employeeId: 'NV03', currentStep: 'Dựng mặt thẻ hiển thị việc đang làm', latestCompletedStep: 'Đã chốt cấu trúc card', nextStep: 'Kiểm tra browser desktop và mobile', targetPrNumber: 200, progressPercent: 70, progressSource: 'explicit_verified' }
  ],
  nextQueue: [],
  recentWork: [],
  workers: [
    { employeeId: 'NV03', label: 'ChatGPT Go', state: 'working', status: 'ĐANG LÀM', detail: 'Đang xử lý card giao diện', provider: 'openai', model: 'GPT-5.6', source: 'PC01 live runtime' }
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
  await expect(page.locator('.workflow-board')).toBeVisible();
  await expect(page.locator('.flow-card-semantics').first()).toBeVisible();
}

test('Owner can understand work cards before opening any drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  const task = page.locator('[data-flow-node="job-111"]');
  await expect(task).toBeVisible();
  await expect(task).toContainText('Xây thẻ công việc đọc là hiểu');
  await expect(task).toContainText('Đang làm');
  await expect(task).toContainText('Dựng mặt thẻ hiển thị việc đang làm');
  await expect(task).toContainText('Đã xong');
  await expect(task).toContainText('Đã chốt cấu trúc card');
  await expect(task).toContainText('Tiếp theo');
  await expect(task).toContainText('Kiểm tra browser desktop và mobile');
  await expect(task).toContainText('Kết quả');
  await expect(task).toContainText('ĐANG LÀM');
  await expect(task).toContainText('PR #200');

  await expect(page.locator('#workDrawer')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.tool-card')).toContainText('ChatGPT Go · GPT-5.6');
  await expect(page.locator('.tool-card')).toContainText('PC01 live runtime');
  await expect(page.locator('.flow-edge-layer path.flow-edge').first()).toBeAttached();
});

test('Owner workflow remains readable without horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTiger(page);

  const task = page.locator('[data-flow-node="job-111"]');
  await expect(task).toBeVisible();
  await expect(task).toContainText('Dựng mặt thẻ hiển thị việc đang làm');
  const metrics = await page.evaluate(() => {
    const edge = document.querySelector('.flow-edge-layer');
    return {
      viewport: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      edgeDisplay: edge ? getComputedStyle(edge).display : 'missing'
    };
  });
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.edgeDisplay).toBe('none');
});

test('work-card picker stays readable with many open packages on mobile and selects active work first', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTiger(page);

  await expect(page.locator('.flow-package-tabs')).toHaveCount(0);
  const choices = page.locator('.flow-package-choice');
  await expect(choices).toHaveCount(13);

  const selected = page.locator('.flow-package-choice.active');
  await expect(selected).toContainText('Làm giao diện TigerIQ dễ hiểu');
  await expect(selected).toContainText('NV03');
  await expect(selected).toContainText('Dựng mặt thẻ hiển thị việc đang làm');

  const box = await selected.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(260);

  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentScroll: document.documentElement.scrollWidth,
    pickerClient: document.querySelector('.flow-package-list')?.clientWidth ?? 0,
    pickerScroll: document.querySelector('.flow-package-list')?.scrollWidth ?? 0
  }));
  expect(metrics.documentScroll).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.pickerScroll).toBeGreaterThan(metrics.pickerClient);
});
