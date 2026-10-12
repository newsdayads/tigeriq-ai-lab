import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const entries = [
  ['apps/dashboard/src/bcct.mjs', 'dist/apps/dashboard/src/bcct.mjs'],
  ['apps/shared/bcct-v4-contract.mjs', 'dist/apps/shared/bcct-v4-contract.mjs'],
];
for (const [from, to] of entries) {
  const source = join(root, from);
  const target = join(root, to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (statSync(target).size < 100) throw new Error('BCCT_RUNTIME_ARTIFACT_EMPTY:' + to);
}

const { renderBcctV4 } = await import(pathToFileURL(join(root, entries[0][1])).href);
const result = renderBcctV4(
  { generatedAt: new Date().toISOString(), workOrders: [
    { id: 'GH-4604', goal: '[P0] BCCT V4 build canary', status: 'blocked' },
  ] },
  'P0',
  'newsdayads/tigeriq-ai-lab',
);
if (!result.ok || typeof result.html !== 'string' ||
    !result.html.includes('href="/bcct?filter=P0"') ||
    !result.html.includes('#4604') ||
    !result.html.includes('RDC05') ||
    !result.html.includes('6. Mốc kế tiếp')) {
  throw new Error('BCCT_DIST_RUNTIME_SMOKE_FAILED');
}
console.log('BCCT_DIST_RUNTIME_SMOKE_PASS: 2 copied MJS modules; 6 sections, filters, GitHub link, RDC5 fallback');
