import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedLane, scoreLane } from '../benchmarks/cline-executor-eval/harness.mjs';

const rootPrefix = path.join(os.tmpdir(), 'tigeriq-4532-lane-v5-');
async function withLane(fn) {
  const root=await mkdtemp(rootPrefix);
  try { const seeded=await seedLane({root,lane:'isolated'}); return await fn(seeded,root); }
  finally { await rm(root,{recursive:true,force:true}); }
}

test('lane root rejects extraneous regular file rather than falsely reporting clean quality', async () => {
  await withLane(async ({laneRoot},root) => {
    await writeFile(path.join(laneRoot, 'rogue.txt'), 'extra unscored payload\n');
    await assert.rejects(scoreLane({root,lane:'isolated'}), /BENCHMARK_LANE_UNEXPECTED_ENTRY/);
  });
});

test('lane root rejects extraneous directory rather than silently excluding its files', async () => {
  await withLane(async ({laneRoot},root) => {
    const extra=path.join(laneRoot, 'out-of-manifest');
    await mkdir(extra);
    await writeFile(path.join(extra, 'hidden.txt'), 'extra\n');
    await assert.rejects(scoreLane({root,lane:'isolated'}), /BENCHMARK_LANE_UNEXPECTED_ENTRY/);
  });
});

test('lane root rejects new symlink even if expected fixture directories are intact', {skip:process.platform==='win32'}, async () => {
  await withLane(async ({laneRoot},root) => {
    await symlink(root,path.join(laneRoot,'external-alias'),'dir');
    await assert.rejects(scoreLane({root,lane:'isolated'}), /BENCHMARK_LANE_UNEXPECTED_ENTRY/);
  });
});

test('canonical lane has exactly the fixture roots and preserves baseline scoring', async () => {
  await withLane(async (_seeded,root) => {
    const row=await scoreLane({root,lane:'isolated'});
    assert.equal(row.total,3);
    assert.equal(row.completed,0);
    assert.equal(row.qualityPass,true);
  });
});

test('lane root rejects missing canonical fixture explicitly, without partial quality score', async () => {
  await withLane(async ({fixtures},root) => {
    await rm(fixtures[0].root,{recursive:true});
    await assert.rejects(scoreLane({root,lane:'isolated'}), /BENCHMARK_LANE_FIXTURE_MISSING/);
  });
});

test('lane root rejects a regular file impersonating a required fixture directory', async () => {
  await withLane(async ({fixtures},root) => {
    await rm(fixtures[0].root,{recursive:true});
    await writeFile(fixtures[0].root,'fake-dir');
    await assert.rejects(scoreLane({root,lane:'isolated'}), /BENCHMARK_LANE_UNEXPECTED_ENTRY/);
  });
});