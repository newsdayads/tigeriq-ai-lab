import { test, expect, chromium } from '@playwright/test';

const base = process.env.TIGERIQ_LIVE_BASE_URL;
const executable = process.env.TIGERIQ_BROWSER_EXECUTABLE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const routes = [
  ['/', '[data-view="work-v5"]'],
  ['/?view=overview', '[data-layout="command-center-v5"]'],
  ['/?view=work', '[data-view="work-v5"]'],
  ['/?view=workforce', '[data-view="workforce-v5"]'],
  ['/?view=system', '[data-view="system-v5"]'],
  ['/?view=models', '[data-view="models-v5"]'],
  ['/?view=reports', '[data-view="reports-v5"]'],
  ['/?view=settings', '[data-view="settings-v5"]'],
] as const;
const viewports = [
  [1648, 928], [1366, 768], [1280, 800], [1024, 768],
  [768, 1024], [624, 900], [430, 932], [390, 844],
] as const;

test('Web Control V5 live machine acceptance', async () => {
  test.skip(!base, 'TIGERIQ_LIVE_BASE_URL is required for live PC01 acceptance');
  const browser = await chromium.launch({ headless: true, executablePath: executable });
  const page = await browser.newPage();
  try {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      for (const [path, marker] of routes) {
        const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        expect(response?.status(), `${width}x${height} ${path}`).toBe(200);
        await expect(page.locator(marker)).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `horizontal overflow ${width}x${height} ${path}`).toBeLessThanOrEqual(1);
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${base}/?view=overview`, { waitUntil: 'domcontentloaded' });
    const link = page.locator('a.cv5-priority-work, .cv5-person a, .x-nav a').first();
    await link.hover(); await link.focus();
    expect(await link.evaluate((el) => document.activeElement === el)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
    const zoomOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(zoomOverflow, 'horizontal overflow at desktop zoom 125%').toBeLessThanOrEqual(1);
    await page.goto(`${base}/people/NV01`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-live-section="entity-content"]')).toBeVisible();
    const linkedWork = page.locator('a[href^="/work/"]');
    if (await linkedWork.count()) await expect(linkedWork.first()).toBeVisible();
    else await expect(page.locator('.ev5-empty')).toBeVisible();
    await page.goto(`${base}/system/worker`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-live-section="entity-content"]')).toBeVisible();
  } finally { await browser.close(); }

  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
  expect(stream.status).toBe(200); expect(stream.headers.get('content-type')).toContain('text/event-stream');
  const reader = stream.body!.getReader(); const first = await reader.read(); await reader.cancel();
  const text = new TextDecoder().decode(first.value);
  expect(text).toContain('event: tigeriq'); expect(text).toContain('event_id');
});
