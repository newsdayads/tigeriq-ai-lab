import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedLane, scoreLane, fixtureChildEnvironment } from '../benchmarks/cline-executor-eval/harness.mjs';

test('benchmark harness seeds identical deterministic fixtures and baseline fails acceptance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tigeriq-cline-bench-'));
  const a = await seedLane({ root, lane: 'a' });
  const b = await seedLane({ root, lane: 'b' });
  assert.equal(a.fixtures.length, 3);
  assert.equal(b.fixtures.length, 3);
  for (let i = 0; i < a.fixtures.length; i += 1) {
    assert.equal(
      await readFile(path.join(a.fixtures[i].root, 'TASK.md'), 'utf8'),
      await readFile(path.join(b.fixtures[i].root, 'TASK.md'), 'utf8'),
    );
  }
  await assert.rejects(access(path.join(a.fixtures[0].root, '.tigeriq-benchmark-baseline.json')));
  const score = await scoreLane({ root, lane: 'a' });
  assert.equal(score.total, 3);
  assert.equal(score.completed, 0);
  assert.equal(score.qualityPass, true);
  assert.ok(score.fixtures.every((row) => row.testCount >= 1 && row.testsPass === false), JSON.stringify(score.fixtures.map((row) => ({fixtureId:row.fixtureId,testExitCode:row.testExitCode,testCount:row.testCount,testsPass:row.testsPass,stdoutTail:row.stdoutTail,stderrTail:row.stderrTail}))));
  const otherLane = await scoreLane({ root, lane: 'b' });
  assert.equal(otherLane.completed, 0);
  assert.equal(otherLane.qualityPass, true);
});

test('scorer rejects test tampering even when a fixture test process exits successfully', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tigeriq-cline-bench-'));
  const seeded = await seedLane({ root, lane: 'tampered' });
  const first = seeded.fixtures[0].root;
  await writeFile(
    path.join(first, 'tests/parse-count.test.mjs'),
    "import test from 'node:test'; test('tampered', () => {});\n",
    'utf8',
  );
  const score = await scoreLane({ root, lane: 'tampered' });
  const row = score.fixtures.find((item) => item.fixtureId === 'strict-count-parser');
  assert.equal(row.testsPass, true);
  assert.equal(row.testsMutated, true);
  assert.equal(row.completed, false);
});


test('immutable manifest prevents forged baseline and TASK tampering from creating a false pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tigeriq-cline-bench-'));
  const seeded = await seedLane({ root, lane: 'forged' });
  const first = seeded.fixtures[0].root;
  await writeFile(
    path.join(first, 'src/parse-count.mjs'),
    "export function parseCount(value) { const text = String(value ?? ''); return /^(?:0|[1-9]\\d*)$/.test(text) ? Number(text) : null; }\n",
    'utf8',
  );
  await writeFile(path.join(first, 'TASK.md'), 'tampered task\n', 'utf8');
  await writeFile(
    path.join(first, '.tigeriq-benchmark-baseline.json'),
    JSON.stringify({ fixtureId: 'strict-count-parser', files: {} }) + '\n',
    'utf8',
  );

  const score = await scoreLane({ root, lane: 'forged' });
  const row = score.fixtures.find((item) => item.fixtureId === 'strict-count-parser');
  assert.equal(row.testsPass, true);
  assert.equal(row.taskMutated, true);
  assert.deepEqual(row.unexpectedFiles, ['.tigeriq-benchmark-baseline.json']);
  assert.equal(row.completed, false);
  assert.equal(score.qualityPass, false);
});

test('fixture subprocess environment has no credentials or inherited node test flags', () => {
  const env=fixtureChildEnvironment({
    PATH:'/mock/bin',
    HOME:'/mock/home',
    NODE_TEST_CONTEXT:'child-v8',
    GITHUB_TOKEN:'top-secret',
    TIGERIQ_GITHUB_TOKEN:'top-secret',
    OLLAMA_API_KEY:'top-secret',
    DATABASE_URL:'top-secret',
    OPENAI_API_KEY:'top-secret',
    NODE_OPTIONS:'--require /tmp/inject.cjs',
  });
  assert.deepEqual(env,{PATH:'/mock/bin',HOME:'/mock/home'});
});

test('seed is fail-closed for force, existing lanes, and traversal paths', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'tigeriq-cline-safe-'));
  const seeded=await seedLane({root,lane:'cline-local-ollama'});
  const file=path.join(seeded.fixtures[0].root,'TASK.md');
  const before=await readFile(file,'utf8');
  await assert.rejects(seedLane({root,lane:'cline-local-ollama',force:true}),/BENCHMARK_FORCE_DELETE_FORBIDDEN/);
  await assert.rejects(seedLane({root,lane:'cline-local-ollama'}),/EEXIST/);
  await assert.rejects(seedLane({root,lane:'../danger'}),/BENCHMARK_LANE_INVALID/);
  await assert.rejects(scoreLane({root,lane:'../danger'}),/BENCHMARK_LANE_INVALID/);
  assert.equal(await readFile(file,'utf8'),before);
});
