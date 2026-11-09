import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedLane, scoreFixture } from '../benchmarks/cline-executor-eval/harness.mjs';

const ROOT_PREFIX = path.join(os.tmpdir(), 'tigeriq-cline-bounded-');

async function withFixture(fn) {
  const root = await mkdtemp(ROOT_PREFIX);
  try {
    const { fixtures } = await seedLane({ root, lane: 'isolated' });
    return await fn(fixtures[0].root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('rejects oversized executor-writable source before tests can be run', async () => {
  await withFixture(async fixture => {
    await writeFile(path.join(fixture, 'src/parse-count.mjs'), 'x'.repeat(1024 * 1024 + 1));
    await assert.rejects(scoreFixture(fixture), /BENCHMARK_FIXTURE_TOO_LARGE/);
  });
});

test('rejects oversized TASK.md regardless of its expected hash', async () => {
  await withFixture(async fixture => {
    await writeFile(path.join(fixture, 'TASK.md'), 'x'.repeat(1024 * 1024 + 1));
    await assert.rejects(scoreFixture(fixture), /BENCHMARK_FIXTURE_TOO_LARGE/);
  });
});

test('allows legitimate small canonical fixture without changing baseline scoring', async () => {
  await withFixture(async fixture => {
    const row = await scoreFixture(fixture);
    assert.equal(row.fixtureId, 'strict-count-parser');
    assert.equal(row.testsPass, false); // The canonical fixture must fail until an executor fixes it.
    assert.equal(row.testsMutated, false);
  });
});

test('allows a genuine bounded solution and scores it successfully', async () => {
  await withFixture(async fixture => {
    await writeFile(path.join(fixture, 'src/parse-count.mjs'),
      "export function parseCount(value) { const text = String(value ?? ''); return /^(0|[1-9]\\d*)$/.test(text) ? Number(text) : null; }\n");
    const row = await scoreFixture(fixture);
    assert.equal(row.testsPass, true);
    assert.equal(row.completed, true);
  });
});

test('rejects symlink in ancestor of benchmark root before creating lane', {skip: process.platform === 'win32'}, async () => {
  const root = await mkdtemp(ROOT_PREFIX);
  const external = await mkdtemp(ROOT_PREFIX);
  const { symlink, access } = await import('node:fs/promises');
  try {
    await symlink(external, path.join(root, 'external-link'), 'dir');
    await assert.rejects(seedLane({root:path.join(root,'external-link','nested'),lane:'isolated'}), /BENCHMARK_SYMLINK_FORBIDDEN/);
    await assert.rejects(access(path.join(external,'nested')));
  } finally {await rm(root,{recursive:true,force:true});await rm(external,{recursive:true,force:true});}
});

test('rejects FIFO replacing expected source file instead of hanging read', {skip: process.platform === 'win32'}, async () => {
  const { execFileSync } = await import('node:child_process');
  await withFixture(async fixture => {
    const p=path.join(fixture,'src/parse-count.mjs');
    await rm(p);
    execFileSync('mkfifo',[p]);
    await assert.rejects(scoreFixture(fixture), /BENCHMARK_NON_REGULAR_FILE_FORBIDDEN/);
  });
});