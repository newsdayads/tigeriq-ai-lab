import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildHtmlReport } from '../tools/project-code-map/html-report.mjs';

const CLI = fileURLToPath(new URL('../tools/project-code-map/cli.mjs', import.meta.url));

test('offline HTML embeds inert JSON and escapes hostile module names', () => {
  const dangerous = '</script><script>window.pwned=true</script>const dangerous = '</script><script>window.pwned=true</script>';';
  const doc = {
    schemaVersion: 1,
    sourceRevision: 'fixture',
    rootName: 'test',
    summary: { sourceFiles: 1, dependencyEdges: 1, filesWithImports: 1 },
    nodes: ['src/main.js'],
    edges: [{ from: 'src/main.js', to: dangerous }],
  };
  const html = buildHtmlReport(doc);
  assert.equal((html.match(/<script/g) || []).length, 2, 'Only inert data and app script are present');
  assert.equal(html.includes(dangerous), false, 'No unescaped data may break a script tag');
  assert.ok(html.includes('\\u003c/script\\u003e'));
  assert.ok(html.includes('  assert.ok(html.includes('\\u003c/script\\u003e'));'), 'Dollar replacement tokens must stay literal');
  assert.ok(html.includes('id="search"'));
  assert.ok(html.includes('type="application/json"'));
  assert.throws(() => buildHtmlReport({ schemaVersion: 2, nodes: [], edges: [], summary: {} }), /CODE_MAP_INVALID_REPORT/);
});

test('CLI writes both real file outputs without a network or service', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tigeriq-code-map-html-'));
  try {
    const root = path.join(tmp, 'repo');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'index.mjs'), "import './other.mjs';");
    await fs.writeFile(path.join(root, 'other.mjs'), 'export default true;');
    const output = path.join(tmp, 'graph.json');
    const htmlFile = path.join(tmp, 'graph.html');
    const run = spawnSync(process.execPath,
      [CLI, '--root', root, '--output', output, '--html', htmlFile], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /CODE_MAP_HTML_OK/);
    const json = JSON.parse(await fs.readFile(output, 'utf8'));
    const html = await fs.readFile(htmlFile, 'utf8');
    assert.equal(json.summary.sourceFiles, 2);
    assert.equal(json.summary.dependencyEdges, 1);
    assert.ok(html.includes('Sơ đồ mã nguồn'));
    assert.ok(html.includes('index.mjs'));
    assert.ok(html.includes('other.mjs'));
    assert.ok(!html.includes(tmp));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
