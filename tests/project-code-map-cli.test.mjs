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
