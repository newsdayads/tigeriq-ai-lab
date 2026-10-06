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
  projectPortfolio: [
    { id:'tigeriq-platform', name:'Nền tảng TigerIQ', order:10, kind:'platform', counts:{working:1,review:1,blocked:0,waiting:8,done:0} },
    { id:'tigeriq-mobile-worker', name:'TigerIQ Mobile Worker', order:20, kind:'project', counts:{working:2,review:0,blocked:0,waiting:0,done:0} }
  ],
  openWork: [
    { number: 100, title: '[P1][UI] Làm giao diện TigerIQ dễ hiểu', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', currentStep: 'Điều phối giao diện thẻ', nextStep: 'Hoàn tất các nhánh' },
    { number: 110, parentNumber: 100, title: '[P1][UI] Nhánh trình bày thẻ công việc', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', currentStep: 'Tổ chức thẻ việc', nextStep: 'Gắn công việc thực thi' },
    { number: 111, parentNumber: 110, title: '[P1][UI] Xây thẻ công việc đọc là hiểu', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', employeeId: 'NV03', currentStep: 'Dựng mặt thẻ công việc', latestCompletedStep: 'Đã chốt cấu trúc card', nextStep: 'Kiểm tra browser desktop và mobile', targetPrNumber: 200, progressPercent: 70, progressSource: 'explicit_verified', updatedAt:'2026-10-04T02:29:40.000Z' },
    { number: 112, parentNumber: 111, title: '[P1][REVIEW] Kiểm tra thẻ công việc', status: 'RÀ SOÁT', workKind: 'WORK', priority: 'P1', reviewOnly: true, employeeId: 'NV12', currentStep: 'Kiểm tra card', targetPrNumber: 200 },
    { number: 113, parentNumber: 111, title: '[P1][RESULT] Xuất bản giao diện mới', status: 'CHỜ ANH SƠN DUYỆT', workKind: 'WORK', priority: 'P1', technicalComplete: true, latestCompletedStep: 'Production đã sẵn sàng', nextStep: 'Duyệt kết quả cuối', targetPrNumber: 200 },
    { number: 120, parentNumber: 100, title: '[P1][UI] Nhánh không có phần trăm xác minh', status: 'ĐANG CHỜ', workKind: 'WORK', priority: 'P1', currentStep: 'Chờ dữ liệu', nextStep: 'Xác minh tiến độ' },
    { number: 121, parentNumber: 120, title: '[P1][UI] Thẻ chưa xác minh tiến độ', status: 'ĐANG CHỜ', workKind: 'WORK', priority: 'P1', employeeId: 'NV04', currentStep: 'Chờ xác minh', nextStep: 'Bổ sung evidence' },
    { number: 500, title: '[P0][ANDROID] Mobile Worker v0.26', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P0', employeeId: 'NV06', currentStep: 'Xác minh runtime Android', latestCompletedStep: 'APK đã build', nextStep: 'Runtime acceptance', updatedAt:'2026-10-04T02:29:40.000Z', projectId:'tigeriq-mobile-worker', projectName:'TigerIQ Mobile Worker', workstreamId:'release', workstreamName:'Phát hành' },
    ...Array.from({ length: 8 }, (_, i) => ({
      number: 300 + i,
      title: '[P2][TEST] Việc phụ '+String(i + 1).padStart(2, '0'),
      status: 'UNKNOWN',
      workKind: 'WORK',
      priority: 'P2',
      currentStep: null,
      nextStep: 'Chờ điều phối'
    }))
  ].map(row=>Number(row.number)===500?row:({
    ...row,
    projectId:'tigeriq-platform',
    projectName:'Nền tảng TigerIQ',
    workstreamId:Number(row.number)>=300?'aux-'+row.number:'live-ui',
    workstreamName:Number(row.number)>=300?'Việc phụ '+row.number:'TigerIQ Live UI'
  })),
  activeWork: [
    { number: 111, parentNumber: 110, title: '[P1][UI] Xây thẻ công việc đọc là hiểu', status: 'ĐANG XỬ LÝ', workKind: 'WORK', priority: 'P1', employeeId: 'NV03', currentStep: 'Dựng mặt thẻ công việc', latestCompletedStep: 'Đã chốt cấu trúc card', nextStep: 'Kiểm tra browser desktop và mobile', targetPrNumber: 200, progressPercent: 70, progressSource: 'explicit_verified' }
  ].map(row=>({
    ...row,
    projectId:'tigeriq-platform',
    projectName:'Nền tảng TigerIQ',
    workstreamId:'live-ui',
    workstreamName:'TigerIQ Live UI'
  })),
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
  await expect(page.locator('.v2-portfolio-layout')).toBeVisible();
}


test('keeps project order stable while highlighting live state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  const names = await page.locator('[data-project-select] .v2-project-copy b').allTextContents();
  expect(names.slice(0,2)).toEqual(['Nền tảng TigerIQ','TigerIQ Mobile Worker']);
  await expect(page.locator('[data-project-select="tigeriq-platform"]')).toHaveClass(/active/);
});

test('owner can see exactly where the active work is and what happens next', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  await expect(page.locator('.v3-running-lane')).toBeVisible();
  await expect(page.locator('.v3-running-lane')).toContainText('Nền tảng TigerIQ');
  await expect(page.locator('.v3-running-lane')).toContainText('TigerIQ Live UI');
  await expect(page.locator('.v3-running-lane')).toContainText('#111 · NV03');
  await expect(page.locator('.v3-running-lane')).toContainText('Dựng mặt thẻ công việc');

  const ops = page.locator('.v3-owner-ops');
  await expect(ops).toBeVisible();
  await expect(ops).toContainText('ĐANG THỰC THI');
  await expect(ops).toContainText('Đang làm gì');
  await expect(ops).toContainText('Dựng mặt thẻ công việc');
  await expect(ops).toContainText('Vừa xong');
  await expect(ops).toContainText('Đã chốt cấu trúc card');
  await expect(ops).toContainText('Bước tiếp theo');
  await expect(ops).toContainText('Kiểm tra browser desktop và mobile');
  await expect(ops).toContainText('Blocker');
  await expect(ops).toContainText('Không có');
  await expect(ops).toContainText('Cập nhật');
});

test('functional audit clicks every owner-facing control without console errors', async ({ page }) => {
  const errors:string[]=[];
  page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});
  page.on('pageerror',err=>errors.push(String(err)));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openTiger(page);

  // Project switch.
  await page.locator('[data-project-select="tigeriq-mobile-worker"]').click();
  await expect(page.locator('.v2-project-header')).toContainText('TigerIQ Mobile Worker');
  await expect(page.locator('.v2-workstream-card')).toHaveCount(1);
  await page.locator('[data-project-select="tigeriq-platform"]').click();
  await expect(page.locator('.v2-project-header')).toContainText('Nền tảng TigerIQ');

  // Workstream switch and return.
  const streams=page.locator('[data-package-select]');
  expect(await streams.count()).toBeGreaterThan(1);
  await streams.nth(1).click();
  await expect(streams.nth(1)).toHaveClass(/active/);
  await streams.first().click();
  await expect(streams.first()).toHaveClass(/active/);

  // Running JOB opens and closes real drawer.
  await page.locator('[data-running-job="111"]').click();
  await expect(page.locator('#workDrawer')).toHaveClass(/open/);
  await expect(page.locator('#drawerTitle')).toContainText('Xây thẻ công việc đọc là hiểu');
  await page.locator('#drawerCloseBottom').click();
  await expect(page.locator('#workDrawer')).not.toHaveClass(/open/);

  // All filters really change active state and render.
  for (const filter of ['action','running','review','waiting','done']) {
    const button=page.locator('.filter[data-filter="'+filter+'"]');
    await button.click();
    await expect(button).toHaveClass(/active/);
    await expect(page.locator('#workList')).toBeVisible();
  }

  // "Việc lớn" is a label; redundant All JOB / Health links are removed from project navigation.
  await expect(page.locator('.v2-project-tabs .v2-tab-label')).toContainText('Việc lớn');
  await expect(page.locator('.v2-project-tabs button')).toHaveCount(0);
  await expect(page.locator('.v2-project-tabs a')).toHaveCount(0);
  await expect(page.locator('.health-utility[href="/index"]')).toHaveCount(1);
  await expect(page.locator('#rawWorkDetails')).toHaveAttribute('open', '');

  expect(errors).toEqual([]);
});


test('keeps only useful navigation controls on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);
  await expect(page.locator('.v2-global-nav a')).toHaveCount(2);
  await expect(page.locator('.v2-global-nav')).toContainText('Dự án');
  await expect(page.locator('.v2-global-nav')).toContainText('Đang chạy');
  await expect(page.locator('.v2-global-nav')).not.toContainText('Tất cả JOB');
  await expect(page.locator('.v2-global-nav')).not.toContainText('API Health');
  await expect(page.locator('.health-utility')).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.v2-mobile-nav a')).toHaveCount(2);
  await expect(page.locator('.v2-mobile-nav')).toContainText('Dự án');
  await expect(page.locator('.v2-mobile-nav')).toContainText('Đang chạy');
  await expect(page.locator('#rawWorkDetails')).toHaveAttribute('open', '');
});

test('running lane and owner snapshot use visible motion only for active work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);
  const motion=await page.evaluate(()=>({
    runningDot:getComputedStyle(document.querySelector('.v3-running-dot')!).animationName,
    runningJobAfter:getComputedStyle(document.querySelector('.v3-running-job')!,'::after').animationName,
    liveBeacon:getComputedStyle(document.querySelector('.v3-live-beacon.is-live span')!).animationName,
  }));
  expect(motion.runningDot).toContain('v3-live-ring');
  expect(motion.runningJobAfter).toContain('v3-scan');
  expect(motion.liveBeacon).toContain('v3-dot-pulse');
});

test('shows the approved Project → Workstream → Flow → Job hierarchy on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  await expect(page.locator('.v2-portfolio-layout')).toBeVisible();
  await expect(page.locator('.v2-project-sidebar')).toBeVisible();
  await expect(page.locator('.v2-project-header')).toBeVisible();
  await expect(page.locator('.v2-workstream-grid')).toBeVisible();
  await expect(page.locator('.v2-flow-stage')).toHaveCount(4);
  await expect(page.locator('.v2-flow-grid')).toContainText('Nguồn & kế hoạch');
  await expect(page.locator('.v2-flow-grid')).toContainText('Phát triển');
  await expect(page.locator('.v2-flow-grid')).toContainText('Rà soát');
  await expect(page.locator('.v2-flow-grid')).toContainText('Phát hành & xác minh');
  await expect(page.locator('.v2-evidence-grid')).toBeVisible();
});

test('shows current Job context and opens technical detail from the flow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  await expect(page.locator('.v2-workstream-detail')).toContainText('Dựng mặt thẻ công việc');
  await expect(page.locator('.v2-workstream-detail')).toContainText('Kiểm tra browser desktop và mobile');
  await expect(page.locator('.v2-workstream-detail')).toContainText('#111');
  await expect(page.locator('.v2-workstream-detail')).toContainText('NV03');

  await page.locator('[data-package-row="111"]').first().click();
  await expect(page.locator('#workDrawer')).toHaveClass(/open/);
  await expect(page.locator('#drawerTitle')).toContainText('Xây thẻ công việc đọc là hiểu');
  await expect(page.locator('#drawerProgress')).toContainText('70%');
  await expect(page.locator('#drawerJob')).toContainText('GH-111');
});

test('keeps raw all-JOB list visible by default', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);
  await expect(page.locator('#rawWorkDetails')).toHaveAttribute('open', '');
  await expect(page.locator('#rawWorkDetails summary')).toContainText('Tất cả JOB');
  await expect(page.locator('#workList')).toBeVisible();
});


test('applies distinct status colors and live motion hooks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTiger(page);

  const working = page.locator('.v2-flow-job.is-working').first();
  const review = page.locator('.v2-flow-job.is-review').first();
  await expect(working).toBeVisible();
  await expect(review).toBeVisible();

  const styles = await page.evaluate(() => {
    const working = document.querySelector('.v2-flow-job.is-working');
    const review = document.querySelector('.v2-flow-job.is-review');
    const stage1 = document.querySelector('.v2-flow-stage:nth-child(1)');
    const stage4 = document.querySelector('.v2-flow-stage:nth-child(4)');
    return {
      workingBorder: working ? getComputedStyle(working).borderColor : '',
      reviewBorder: review ? getComputedStyle(review).borderColor : '',
      stage1Border: stage1 ? getComputedStyle(stage1).borderColor : '',
      stage4Border: stage4 ? getComputedStyle(stage4).borderColor : '',
      workingAnimation: working ? getComputedStyle(working).animationName : '',
    };
  });
  expect(styles.workingBorder).not.toBe(styles.reviewBorder);
  expect(styles.stage1Border).not.toBe(styles.stage4Border);
  expect(styles.workingAnimation).toContain('v2-working-pulse');
});

test('uses the same hierarchy on mobile without document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTiger(page);

  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentScroll: document.documentElement.scrollWidth,
    flowColumns: getComputedStyle(document.querySelector('.v2-flow-grid')!).gridTemplateColumns,
    rawOpen: document.querySelector('#rawWorkDetails')?.hasAttribute('open') ?? false
  }));
  expect(metrics.documentScroll).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.rawOpen).toBe(true);
  expect(metrics.flowColumns.split(' ').length).toBe(1);
  await expect(page.locator('.v2-mobile-nav')).toBeVisible();
  await expect(page.locator('.v2-project-list')).toBeVisible();
  await expect(page.locator('.v2-workstream-card')).toHaveCount(9);
});

test('keeps multiple large workstreams selectable instead of rendering every Job as a top-level card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTiger(page);

  await expect(page.locator('.v2-workstream-card')).toHaveCount(9);
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
