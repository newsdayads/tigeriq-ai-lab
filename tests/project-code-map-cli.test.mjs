import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CLI = fileURLToPath(new URL('../tools/project-code-map/cli.mjs', import.meta.url));

test('CLI runs on real local project files and writes portable code graph JSON', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tigeriq-code-map-'));
  const root = path.join(tmp, 'repo');
  const output = path.join(tmp, 'result', 'code-map.json');
  try {
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main.mjs'), [
      'import { a } from "./a.mjs";',
      'const b = () => import("./b.mjs");',
      'const unknown = () => import(variable);',
      '// import("./fake.mjs");',
      'const quoted = "import(./phantom.mjs)";',
    ].join('\n'));
    await fs.writeFile(path.join(root, 'src', 'a.mjs'), 'export const a = 1;');
    await fs.writeFile(path.join(root, 'src', 'b.mjs'), 'export const b = 2;');
    await fs.writeFile(path.join(root, 'dist', 'ignored.js'), 'import "./not-real.js";');
    const result = spawnSync(process.execPath, [CLI, '--root', root, '--output', output], {
      encoding: 'utf8',
      env: { ...process.env, TIGERIQ_SOURCE_SHA: 'fixture-revision' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /CODE_MAP_OK/);
    const report = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.sourceRevision, 'fixture-revision');
    assert.deepEqual(report.nodes, ['src/a.mjs', 'src/b.mjs', 'src/main.mjs']);
    assert.deepEqual(report.edges, [
      { from: 'src/main.mjs', to: './a.mjs' },
      { from: 'src/main.mjs', to: './b.mjs' },
    ]);
    assert.deepEqual(report.summary, {
      sourceFiles: 3,
      dependencyEdges: 2,
      filesWithImports: 1,
    });
    assert.ok(!JSON.stringify(report).includes(tmp), 'No machine-absolute paths in the output');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('CLI stdout, help and invalid input have stable exit contracts', async () => {
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node tools\/project-code-map\/cli.mjs/);
  const invalid = spawnSync(process.execPath, [CLI, '--no-such-option'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Unknown option/);
  const missing = spawnSync(process.execPath, [CLI, '--root'], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  const nowhere = spawnSync(process.execPath, [CLI, '--root', path.join(os.tmpdir(), 'tigeriq-no-such-root-' + process.pid)], { encoding: 'utf8' });
  assert.equal(nowhere.status, 1);
  assert.match(nowhere.stderr, /CODE_MAP_FAILED/);
});


test('targeted CLI query returns real scoped incoming/outgoing edges and rejects stale source', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tigeriq-code-map-query-'));
  const root = path.join(tmp, 'repo');
  const revision = 'a'.repeat(40);
  try {
    await fs.mkdir(path.join(root, 'src', 'utils'), { recursive: true });
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main.mjs'), [
      "import './component';",
      "import './utils';",
      "import 'node:fs';",
      "import '../../out-of-root';",
    ].join('\n'));
    await fs.writeFile(path.join(root, 'src', 'consumer.js'), "import './component';");
    await fs.writeFile(path.join(root, 'src', 'component.tsx'), 'export const Component = 1;');
    await fs.writeFile(path.join(root, 'src', 'utils', 'index.mts'), 'export const util = 2;');
    await fs.writeFile(path.join(root, 'dist', 'hidden.tsx'), "import '../src/component';");
    const run = (...args) => spawnSync(process.execPath,
      [CLI, '--root', root, ...args], {
        encoding: 'utf8', env: { ...process.env, TIGERIQ_SOURCE_SHA: revision },
      });
    const full = run();
    assert.equal(full.status, 0, full.stderr);
    const mainQuery = run('--query', 'src/main.mjs', '--expect-sha', revision);
    assert.equal(mainQuery.status, 0, mainQuery.stderr);
    const scoped = JSON.parse(mainQuery.stdout);
    assert.equal(scoped.sourceRef, 'src/main.mjs');
    assert.equal(scoped.sourceRevision, revision);
    assert.equal(scoped.revisionChecked, true);
    const unchecked = run('--query', 'src/main.mjs');
    assert.equal(unchecked.status, 0, unchecked.stderr);
    assert.equal(JSON.parse(unchecked.stdout).revisionChecked, false,
      'Queries without a SHA guard must never claim freshness');
    const savedQuery = path.join(tmp, 'saved-query.json');
    const persisted = run('--query', 'src/main.mjs', '--expect-sha', revision,
      '--output', savedQuery);
    assert.equal(persisted.status, 0, persisted.stderr);
    assert.match(persisted.stderr, /CODE_MAP_QUERY_OK/);
    assert.equal(JSON.parse(await fs.readFile(savedQuery, 'utf8')).sourceRef, 'src/main.mjs');
    assert.deepEqual(scoped.outgoing, [
      { specifier: '../../out-of-root', resolvedTarget: null },
      { specifier: './component', resolvedTarget: 'src/component.tsx' },
      { specifier: './utils', resolvedTarget: 'src/utils/index.mts' },
      { specifier: 'node:fs', resolvedTarget: null },
    ]);
    assert.deepEqual(scoped.incoming, []);
    assert.ok(Buffer.byteLength(mainQuery.stdout) < Buffer.byteLength(full.stdout));
    assert.ok(!mainQuery.stdout.includes('hidden.tsx'));
    assert.ok(!mainQuery.stdout.includes('export const Component'));

    const reverse = run('--query', 'src/component.tsx', '--expect-sha', revision);
    assert.equal(reverse.status, 0, reverse.stderr);
    assert.deepEqual(JSON.parse(reverse.stdout).incoming, [
      { from: 'src/consumer.js', specifier: './component' },
      { from: 'src/main.mjs', specifier: './component' },
    ]);

    const stale = run('--query', 'src/component.tsx', '--expect-sha', 'b'.repeat(40));
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /CODE_MAP_STALE_REVISION/);
    const missingRevision = spawnSync(process.execPath,
      [CLI, '--root', root, '--query', 'src/component.tsx', '--expect-sha', revision],
      { encoding: 'utf8', env: { ...process.env, TIGERIQ_SOURCE_SHA: '' } });
    assert.equal(missingRevision.status, 1);
    assert.match(missingRevision.stderr, /CODE_MAP_STALE_REVISION/);
    const missing = run('--query', 'src/not-exists.js');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /CODE_MAP_MODULE_NOT_FOUND/);
    const traversal = run('--query', '../outside.js');
    assert.equal(traversal.status, 1);
    assert.match(traversal.stderr, /CODE_MAP_INVALID_MODULE_PATH/);
    const invalidCombination = run('--query', 'src/main.mjs', '--html', path.join(tmp, 'graph.html'));
    assert.equal(invalidCombination.status, 2);
    assert.match(invalidCombination.stderr, /Cannot combine --query with --html/);
    const invalidSha = run('--query', 'src/main.mjs', '--expect-sha', 'invalid');
    assert.equal(invalidSha.status, 2);
    assert.match(invalidSha.stderr, /Invalid --expect-sha/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
