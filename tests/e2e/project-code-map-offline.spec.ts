import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHtmlReport } from '../../tools/project-code-map/html-report.mjs';

test.use({ channel: 'chrome' });

test('real Chrome opens offline code-map, searches and navigates local dependencies', async ({ page }) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tigeriq-code-map-browser-'));
  try {
    const malicious = '</script><script>window.codeMapInjected=true</script>';
    const html = buildHtmlReport({
      schemaVersion: 1,
      sourceRevision: 'fixture-browser',
      rootName: 'source',
      summary: { sourceFiles: 3, dependencyEdges: 3, filesWithImports: 1 },
      nodes: ['src/a.mjs', 'src/b.mjs', 'src/main.mjs'],
      edges: [
        { from: 'src/main.mjs', to: './a.mjs' },
        { from: 'src/main.mjs', to: './b.mjs' },
        { from: 'src/main.mjs', to: malicious },
      ],
    });
    const filename = path.join(tmp, 'index.html');
    await fs.writeFile(filename, html);
    await page.goto(pathToFileURL(filename).href);
    await expect(page.getByText('3', { exact: true }).first()).toBeVisible();
    await page.getByRole('searchbox', { name: 'Tìm module' }).fill('main.mjs');
    await expect(page.getByText('1 / 3 tệp')).toBeVisible();
    await page.getByRole('button', { name: 'src/main.mjs' }).click();
    await expect(page.getByRole('heading', { name: 'Import từ tệp (3)' })).toBeVisible();
    await page.getByRole('button', { name: './a.mjs' }).click();
    await expect(page.getByRole('heading', { name: 'src/a.mjs' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tệp đang phụ thuộc vào tệp này (1)' })).toBeVisible();
    expect(await page.evaluate(() => Boolean((window as any).codeMapInjected))).toBe(false);
    await page.getByRole('searchbox', { name: 'Tìm module' }).fill('');
    await page.getByRole('checkbox', { name: 'Chỉ tệp có import' }).check();
    await expect(page.getByText('1 / 3 tệp')).toBeVisible();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});


test('offline viewer navigates extensionless JS/TS modules and their reverse dependencies', async ({ page }) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tigeriq-code-map-extensionless-'));
  const mappings = [
    { spec: './components/Button', target: 'src/components/Button.tsx' },
    { spec: './widget', target: 'src/widget.jsx' },
    { spec: './utils', target: 'src/utils/index.mts' },
    { spec: './legacy', target: 'src/legacy.cts' },
  ];
  try {
    const html = buildHtmlReport({
      schemaVersion: 1,
      sourceRevision: 'extensionless-browser-fixture',
      rootName: 'source',
      summary: { sourceFiles: 5, dependencyEdges: 5, filesWithImports: 1 },
      nodes: ['src/main.mjs', ...mappings.map(({ target }) => target)],
      edges: [
        ...mappings.map(({ spec }) => ({ from: 'src/main.mjs', to: spec })),
        { from: 'src/main.mjs', to: './missing' },
      ],
    });
    const filename = path.join(tmp, 'index.html');
    await fs.writeFile(filename, html);
    await page.goto(pathToFileURL(filename).href);

    for (const { spec, target } of mappings) {
      await page.locator('#module-list').getByRole('button', { name: 'src/main.mjs', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Import từ tệp (5)' })).toBeVisible();
      await page.getByRole('button', { name: spec, exact: true }).click();
      await expect(page.getByRole('heading', { name: target, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Tệp đang phụ thuộc vào tệp này (1)' })).toBeVisible();
    }
    await page.locator('#module-list').getByRole('button', { name: 'src/main.mjs', exact: true }).click();
    await expect(page.getByText('module ngoài hoặc chưa phân giải')).toBeVisible();
    await expect(page.getByRole('button', { name: './missing', exact: true })).toHaveCount(0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});


test('real repository CLI HTML opens as file URL and navigates live source edges', async ({ page }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const cli = fileURLToPath(new URL('../../tools/project-code-map/cli.mjs', import.meta.url));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tigeriq-code-map-file-url-'));
  const htmlFile = path.join(temp, 'real-code-map.html');
  const jsonFile = path.join(temp, 'real-code-map.json');
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });

  try {
    // This must use the CLI output from the real checkout, not a small HTML fixture.
    const run = spawnSync(process.execPath,
      [cli, '--root', root, '--output', jsonFile, '--html', htmlFile],
      { encoding: 'utf8', timeout: 60000 });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain('CODE_MAP_HTML_OK');

    // Unlike page.setContent(), navigation actually exercises browser file:// policy.
    await page.goto(pathToFileURL(htmlFile).href);
    expect(page.url()).toMatch(/^file:\/\//);
    await expect(page.locator('#file-stat')).not.toHaveText('');
    await expect(page.locator('#edge-stat')).not.toHaveText('');
    await page.getByRole('searchbox', { name: 'Tìm module' })
      .fill('tools/project-code-map/cli.mjs');
    await page.locator('#module-list')
      .getByRole('button', { name: 'tools/project-code-map/cli.mjs', exact: true })
      .click();
    await expect(page.locator('#focus-title'))
      .toHaveText('tools/project-code-map/cli.mjs');

    // The real source imports this real module. Check forward and reverse navigation.
    await page.locator('#details')
      .getByRole('button', { name: './scanner.mjs', exact: true })
      .click();
    await expect(page.locator('#focus-title'))
      .toHaveText('tools/project-code-map/scanner.mjs');
    await expect(page.getByRole('heading',
      { name: /Tệp đang phụ thuộc vào tệp này/ })).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
