import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedLane, scoreFixture, scoreLane } from '../benchmarks/cline-executor-eval/harness.mjs';

const withFixture = async (fn) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tigeriq-cline-dir-integrity-'));
  try {
    const lane = await seedLane({ root, lane: 'integrity' });
    return await fn({ root, fixtureRoot: lane.fixtures[0].root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test('fixture unlisted empty directory is rejected, not treated as clean', async () => {
  await withFixture(async ({ fixtureRoot }) => {
    await mkdir(path.join(fixtureRoot, 'untrusted-empty'));
    const result = await scoreFixture(fixtureRoot);
    assert.equal(result.testsPass, false);
    assert.equal(result.testExitCode, null);
    assert.deepEqual(result.unexpectedFiles, ['untrusted-empty/']);
  });
});

test('fixture unlisted nested empty directory cannot bypass qualityPass', async () => {
  await withFixture(async ({ root, fixtureRoot }) => {
    await mkdir(path.join(fixtureRoot, 'src', 'unlisted-empty'));
    const result = await scoreLane({ root, lane: 'integrity' });
    assert.equal(result.qualityPass, false);
    assert.deepEqual(result.fixtures[0].unexpectedFiles, ['src/unlisted-empty/']);
  });
});

test('legitimate manifest directory structure remains clean', async () => {
  await withFixture(async ({ fixtureRoot }) => {
    const result = await scoreFixture(fixtureRoot);
    assert.deepEqual(result.unexpectedFiles, []);
    assert.equal(result.testsMutated, false);
    assert.equal(result.taskMutated, false);
  });
});