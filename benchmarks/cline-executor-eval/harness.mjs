import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, 'fixture-manifest.json');

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function readManifest() {
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

async function walkFiles(root, rel = '') {
  const dir = path.join(root, rel);
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...await walkFiles(root, child));
    else out.push(child.split(path.sep).join('/'));
  }
  return out;
}

export async function seedLane({ root, lane, force = false } = {}) {
  if (!root || !lane) throw new Error('root_and_lane_required');
  const manifest = await readManifest();
  const laneRoot = path.resolve(root, lane);
  if (force) await rm(laneRoot, { recursive: true, force: true });
  await mkdir(laneRoot, { recursive: true });

  const seeded = [];
  for (const fixture of manifest.fixtures) {
    const fixtureRoot = path.join(laneRoot, fixture.id);
    await mkdir(fixtureRoot, { recursive: true });
    const baseline = { fixtureId: fixture.id, files: {} };
    for (const [rel, content] of Object.entries(fixture.files)) {
      const target = path.join(fixtureRoot, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
      baseline.files[rel] = { sha256: sha256(content), content };
    }
    await writeFile(
      path.join(fixtureRoot, '.tigeriq-benchmark-baseline.json'),
      JSON.stringify(baseline, null, 2) + '\n',
      'utf8',
    );
    await writeFile(path.join(fixtureRoot, 'TASK.md'), fixture.prompt + '\n', 'utf8');
    seeded.push({ id: fixture.id, root: fixtureRoot, prompt: fixture.prompt });
  }
  return { version: manifest.version, lane, laneRoot, fixtures: seeded };
}

function changedLineCount(before, after) {
  const a = String(before).split(/\r?\n/);
  const b = String(after).split(/\r?\n/);
  const n = Math.max(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < n; i += 1) if ((a[i] ?? '') !== (b[i] ?? '')) changed += 1;
  return changed;
}

export async function scoreFixture(fixtureRoot) {
  const baseline = JSON.parse(await readFile(path.join(fixtureRoot, '.tigeriq-benchmark-baseline.json'), 'utf8'));
  const allFiles = (await walkFiles(fixtureRoot))
    .filter((rel) => !['.tigeriq-benchmark-baseline.json', 'TASK.md'].includes(rel));
  const baselinePaths = new Set(Object.keys(baseline.files));
  const unexpectedFiles = allFiles.filter((rel) => !baselinePaths.has(rel));
  let filesChanged = 0;
  let linesChanged = 0;
  let testsMutated = false;

  for (const [rel, original] of Object.entries(baseline.files)) {
    let current = '';
    try { current = await readFile(path.join(fixtureRoot, rel), 'utf8'); } catch {}
    if (sha256(current) !== original.sha256) {
      filesChanged += 1;
      linesChanged += changedLineCount(original.content, current);
      if (rel.startsWith('tests/')) testsMutated = true;
    }
  }

  const testRun = spawnSync(process.execPath, ['--test', 'tests'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  const testsPass = testRun.status === 0;
  return {
    fixtureId: baseline.fixtureId,
    completed: testsPass && !testsMutated && unexpectedFiles.length === 0,
    testsPass,
    testExitCode: testRun.status,
    testsMutated,
    unexpectedFiles,
    filesChanged,
    linesChanged,
    stdoutTail: String(testRun.stdout || '').slice(-1200),
    stderrTail: String(testRun.stderr || '').slice(-1200),
  };
}

export async function scoreLane({ root, lane } = {}) {
  if (!root || !lane) throw new Error('root_and_lane_required');
  const manifest = await readManifest();
  const laneRoot = path.resolve(root, lane);
  const fixtures = [];
  for (const fixture of manifest.fixtures) {
    fixtures.push(await scoreFixture(path.join(laneRoot, fixture.id)));
  }
  const completed = fixtures.filter((item) => item.completed).length;
  return {
    version: manifest.version,
    lane,
    completed,
    total: fixtures.length,
    completionRate: fixtures.length ? completed / fixtures.length : 0,
    qualityPass: fixtures.every((item) => !item.testsMutated && item.unexpectedFiles.length === 0),
    fixtures,
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const root = arg('--root');
  const lane = arg('--lane');
  const force = process.argv.includes('--force');
  const result = command === 'seed'
    ? await seedLane({ root, lane, force })
    : command === 'score'
      ? await scoreLane({ root, lane })
      : null;
  if (!result) {
    console.error('usage: node harness.mjs <seed|score> --root <dir> --lane <name> [--force]');
    process.exitCode = 2;
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}
