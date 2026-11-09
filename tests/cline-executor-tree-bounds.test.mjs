import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedLane, scoreFixture } from '../benchmarks/cline-executor-eval/harness.mjs';

async function withFixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tigeriq-4532-tree-'));
  try {
    const seeded = await seedLane({root, lane: 'isolated'});
    return await fn(seeded.fixtures[0].root);
  } finally {
    await rm(root, {recursive:true, force:true});
  }
}

test('fixture scanner rejects over-budget regular file entries before unbounded scan', async () => {
  await withFixture(async fixture => {
    for (let i = 0; i < 260; i += 1)
      await writeFile(path.join(fixture, 'stray-' + String(i).padStart(3, '0')), 'x');
    await assert.rejects(scoreFixture(fixture), /BENCHMARK_TREE_ENTRY_LIMIT/);
  });
});

test('fixture scanner rejects a deeply nested directory chain', async () => {
  await withFixture(async fixture => {
    let dir = fixture;
    for (let i = 0; i < 27; i += 1) {
      dir = path.join(dir, 'd');
      await mkdir(dir);
    }
    await writeFile(path.join(dir, 'nested.txt'), 'x');
    await assert.rejects(scoreFixture(fixture), /BENCHMARK_TREE_DEPTH_LIMIT/);
  });
});