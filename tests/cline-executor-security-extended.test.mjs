// Additional local source-only hardening regression for #4532.
// This file is NOT on GitHub main and must not be treated as independent QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, link, stat, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { seedLane, scoreLane, scoreFixture } from '../benchmarks/cline-executor-eval/harness.mjs';

const PREFIX = path.join(os.tmpdir(), 'tigeriq-4532-extended-');
const posix = process.platform !== 'win32';
const CAP = 1024 * 1024;

async function withLane(fn) {
  const root = await mkdtemp(PREFIX);
  try {
    const seeded = await seedLane({ root, lane: 'disposable' });
    return await fn({ root, lane: seeded.lane, fixtures: seeded.fixtures });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('boundary: an exactly-1MiB TASK is bounded but still rejected as tampering', async () => {
  await withLane(async ({ fixtures }) => {
    await writeFile(path.join(fixtures[0].root, 'TASK.md'), 'Z'.repeat(CAP));
    const result = await scoreFixture(fixtures[0].root);
    assert.equal(result.taskMutated, true);
    assert.equal(result.testsPass, false);
    assert.equal(result.stderrTail, 'BENCHMARK_UNTRUSTED_FIXTURE_REJECTED');
  });
});

test('oversized acceptance test is rejected before any test process starts', async () => {
  await withLane(async ({ fixtures }) => {
    await writeFile(path.join(fixtures[0].root, 'tests/parse-count.test.mjs'), 'Z'.repeat(CAP + 1));
    await assert.rejects(scoreFixture(fixtures[0].root), /BENCHMARK_FIXTURE_TOO_LARGE/);
  });
});

test('unexpected oversized regular file is flagged and never scored as clean', async () => {
  await withLane(async ({ fixtures }) => {
    await writeFile(path.join(fixtures[0].root, 'junk.log'), 'Z'.repeat(CAP * 2));
    const result = await scoreFixture(fixtures[0].root);
    assert.deepEqual(result.unexpectedFiles, ['junk.log']);
    assert.equal(result.testsPass, false);
    assert.equal(result.stderrTail, 'BENCHMARK_UNTRUSTED_FIXTURE_REJECTED');
  });
});

test('missing expected source is classified as changed rather than an exception', async () => {
  await withLane(async ({ fixtures }) => {
    await unlink(path.join(fixtures[0].root, 'src/parse-count.mjs'));
    const result = await scoreFixture(fixtures[0].root);
    assert.ok(result.filesChanged >= 1);
    assert.equal(result.testsPass, false);
  });
});

test('task content tampering never invokes fixture tests', async () => {
  await withLane(async ({ fixtures }) => {
    await writeFile(path.join(fixtures[0].root, 'TASK.md'), 'changed\n');
    const result = await scoreFixture(fixtures[0].root);
    assert.equal(result.taskMutated, true);
    assert.equal(result.testExitCode, null);
  });
});

test('scoreLane catches a symlink in ancestor of its root', { skip: !posix }, async () => {
  const root = await mkdtemp(PREFIX);
  try {
    const real = path.join(root, 'real');
    await seedLane({ root: real, lane: 'isolated' });
    await symlink(real, path.join(root, 'alias'), 'dir');
    await assert.rejects(scoreLane({ root: path.join(root, 'alias'), lane: 'isolated' }), /BENCHMARK_SYMLINK_FORBIDDEN/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('scoreFixture catches a symlink in ancestor of fixture', { skip: !posix }, async () => {
  await withLane(async ({root, fixtures}) => {
    const alias = path.join(root, 'alias');
    await symlink(path.join(root, 'disposable'), alias, 'dir');
    await assert.rejects(scoreFixture(path.join(alias, path.basename(fixtures[0].root))), /BENCHMARK_SYMLINK_FORBIDDEN/);
  });
});

test('nested src directory symlink is rejected instead of scanning outside root', { skip: !posix }, async () => {
  await withLane(async ({root, fixtures}) => {
    const src = path.join(fixtures[0].root, 'src');
    await rm(src, { recursive: true });
    await symlink(root, src, 'dir');
    await assert.rejects(scoreFixture(fixtures[0].root), /BENCHMARK_SYMLINK_FORBIDDEN/);
  });
});

test('FIFO replacing TASK.md is rejected without reading its stream', { skip: !posix }, async () => {
  await withLane(async ({fixtures}) => {
    const p = path.join(fixtures[0].root, 'TASK.md');
    await unlink(p);
    execFileSync('mkfifo', [p]);
    await assert.rejects(scoreFixture(fixtures[0].root), /BENCHMARK_NON_REGULAR_FILE_FORBIDDEN/);
  });
});

test('FIFO replacing an acceptance test is rejected before execution', { skip: !posix }, async () => {
  await withLane(async ({fixtures}) => {
    const p = path.join(fixtures[0].root, 'tests/parse-count.test.mjs');
    await unlink(p);
    execFileSync('mkfifo', [p]);
    await assert.rejects(scoreFixture(fixtures[0].root), /BENCHMARK_NON_REGULAR_FILE_FORBIDDEN/);
  });
});

test('unexpected UNIX socket is rejected as a non-regular fixture node', { skip: !posix }, async () => {
  await withLane(async ({fixtures}) => {
    const p = path.join(fixtures[0].root, 'socket.node');
    const server = createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(p, resolve));
    try {
      assert.equal((await stat(p)).isSocket(), true);
      await assert.rejects(scoreFixture(fixtures[0].root), /BENCHMARK_NON_REGULAR_FILE_FORBIDDEN/);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

test('hardlink to external inode at canonical TASK path must not be accepted', { skip: !posix }, async () => {
  await withLane(async ({root, fixtures}) => {
    const p = path.join(fixtures[0].root, 'TASK.md');
    const original = await (await import('node:fs/promises')).readFile(p);
    const external = path.join(root, 'external-task-data');
    await writeFile(external, original);
    await unlink(p);
    await link(external, p);
    assert.equal((await stat(p)).nlink, 2);
    await assert.rejects(scoreFixture(fixtures[0].root), /BENCHMARK_HARDLINK_FORBIDDEN/);
  });
});

test('hardlink to external inode at canonical source path must not be accepted', { skip: !posix }, async () => {
  await withLane(async ({root, fixtures}) => {
    const p = path.join(fixtures[0].root, 'src/parse-count.mjs');
    const original = await (await import('node:fs/promises')).readFile(p);
    const external = path.join(root, 'external-source-data');
    await writeFile(external, original);
    await unlink(p);
    await link(external, p);
    assert.equal((await stat(p)).nlink, 2);
    await assert.rejects(scoreFixture(fixtures[0].root), /BENCHMARK_HARDLINK_FORBIDDEN/);
  });
});