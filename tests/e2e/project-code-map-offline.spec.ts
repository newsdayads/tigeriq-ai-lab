import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
