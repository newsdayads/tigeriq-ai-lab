import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));
let server: Server | null = null;
let baseUrl = '';

const contentType = (path: string) => ({ '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json' }[extname(path)] || 'text/plain; charset=utf-8');

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error:'NOT_AVAILABLE_IN_STATIC_E2E' }));
      return;
    }
    const relative = url.pathname === '/' ? 'web-v1/index.html' : url.pathname.replace(/^\/+/, '');
    const safe = normalize(relative).replace(/^\.\.(?:[\\/]|$)/, '');
    try {
      const body = await readFile(join(publicDir, safe));
      res.writeHead(200, { 'content-type': contentType(safe), 'cache-control':'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type':'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('E2E_SERVER_ADDRESS_INVALID');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (!server) return;
  await new Promise<void>(resolve => server!.close(() => resolve()));
});

test('Company Control Tower is iPhone-first, business-first and mock-truthful', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://accounts.google.com/**', route => route.abort());
  await page.goto(`${baseUrl}/web-v1/index.html`, { waitUntil:'domcontentloaded' });
  await expect(page.locator('#primaryGoalTitle')).toContainText('Radar cơ hội kinh doanh TigerIQ');
  await expect(page.getByText('DỮ LIỆU MẪU · authoritative=false').first()).toBeVisible();
  await expect(page.locator('.owner-attention h3')).toHaveText('CẦN SẾP');
  await expect(page.getByText('Doanh thu · chi phí · outcome')).toBeVisible();
  await expect(page.getByText('SHA & CI')).not.toBeVisible();

  const mobile = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const navButton = document.querySelector('.nav button');
    if (!sidebar || !navButton) throw new Error('MOBILE_LAYOUT_ELEMENTS_MISSING');
    return {
      innerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      sidebarPosition: getComputedStyle(sidebar).position,
      sidebarBottom: getComputedStyle(sidebar).bottom,
      navMinHeight: getComputedStyle(navButton).minHeight,
    };
  });
  expect(mobile.bodyScrollWidth).toBeLessThanOrEqual(mobile.innerWidth + 1);
  expect(mobile.sidebarPosition).toBe('fixed');
  expect(mobile.sidebarBottom).toBe('0px');
  expect(Number.parseFloat(mobile.navMinHeight)).toBeGreaterThanOrEqual(44);

  await page.locator('.nav button[data-view="technical"]').click();
  await expect(page.locator('[data-section="technical"] h2')).toHaveText('Vận hành kỹ thuật');
  await expect(page.getByText('SHA & CI')).toBeVisible();
  await expect(page.getByText('LEASE / PORT')).toBeVisible();
});
