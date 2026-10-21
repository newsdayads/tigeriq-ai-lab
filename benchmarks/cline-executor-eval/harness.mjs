import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('BENCHMARK_SYMLINK_FORBIDDEN:' + rel);
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isSymbolicLink()) throw new Error('BENCHMARK_SYMLINK_FORBIDDEN:' + child);
    if (entry.isDirectory()) out.push(...await walkFiles(root, child));
    else out.push(child.split(path.sep).join('/'));
  }
  return out;
}

export async function seedLane({ root, lane, force = false } = {}) {
  if (!root || !lane) throw new Error('root_and_lane_required');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(String(lane))) throw new Error('BENCHMARK_LANE_INVALID');
  if (force) throw new Error('BENCHMARK_FORCE_DELETE_FORBIDDEN');
  const manifest = await readManifest();
  const benchmarkRoot = path.resolve(root);
  const laneRoot = path.join(benchmarkRoot, lane);
  await mkdir(benchmarkRoot, { recursive: true });
  if ((await lstat(benchmarkRoot)).isSymbolicLink()) throw new Error('BENCHMARK_SYMLINK_FORBIDDEN:root');
  // Atomic create: never erase or overwrite a previous benchmark lane.
  await mkdir(laneRoot);

  const seeded = [];
  for (const fixture of manifest.fixtures) {
    const fixtureRoot = path.join(laneRoot, fixture.id);
    await mkdir(fixtureRoot, { recursive: true });
    for (const [rel, content] of Object.entries(fixture.files)) {
      const target = path.join(fixtureRoot, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
    await writeFile(path.join(fixtureRoot, 'TASK.md'), fixture.prompt + '\n', 'utf8');
    seeded.push({ id: fixture.id, root: fixtureRoot, prompt: fixture.prompt });
  }
  return { version: manifest.version, lane, laneRoot, fixtures: seeded };
}

export function changedLineCount(before, after) {
  const a = String(before) === '' ? [] : String(before).split(/\r?\n/);
  const b = String(after) === '' ? [] : String(after).split(/\r?\n/);
  // Keep unchanged prefixes and suffixes out of the comparison.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  // LCS counts shifted matching lines as unchanged; the remaining
  // additions and deletions form the actual line delta.
  const previous = new Uint32Array(endB - start + 1);
  for (let i = start; i < endA; i++) {
    let diagonal = 0;
    for (let j = start; j < endB; j++) {
      const col = j - start + 1;
      const old = previous[col];
      previous[col] = a[i] === b[j] ? diagonal + 1 : Math.max(previous[col], previous[col - 1]);
      diagonal = old;
    }
  }
  const common = previous[endB - start];
  return (endA - start) + (endB - start) - 2 * common;
}

// Fixture tests must never inherit the coordinator's GitHub/Ollama/API secrets
// or NODE_TEST_CONTEXT (which silently skips nested tests).
export function fixtureChildEnvironment(source=process.env){
  const allowed=['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA'];
  return Object.fromEntries(allowed
    .filter((key)=>typeof source[key]==='string')
    .map((key)=>[key,source[key]]));
}

/** TAP must show every discovered acceptance test genuinely passed. */
export function verifyFixtureTapSummary({status,stdout}={}){
  const lines=String(stdout||'').split(/\r?\n/);
  const read=(field)=>{
    const prefix='# '+field+' ';
    const rows=lines.filter(line=>line.startsWith(prefix));
    if(rows.length!==1)return null;
    const text=rows[0].slice(prefix.length).trim();
    if(!/^\d+$/.test(text))return null;
    return Number(text);
  };
  const testCount=read('tests'),passed=read('pass');
  const failed=read('fail'),skipped=read('skipped'),todo=read('todo'),cancelled=read('cancelled');
  const complete=[testCount,passed,failed,skipped,todo,cancelled].every(Number.isSafeInteger);
  const testsPass=complete&&status===0&&testCount>0&&passed===testCount&&failed===0&&skipped===0&&todo===0&&cancelled===0;
  return {testCount:testCount||0,passed:passed||0,skipped:skipped||0,testsPass};
}

export async function scoreFixture(fixtureRoot) {
  const manifest = await readManifest();
  const fixtureId = path.basename(path.resolve(fixtureRoot));
  const fixture = manifest.fixtures.find((item) => item.id === fixtureId);
  if (!fixture) throw new Error('unknown_fixture:' + fixtureId);

  const expectedFiles = fixture.files;
  const expectedPaths = new Set(Object.keys(expectedFiles));
  const allowedPaths = new Set([...expectedPaths, 'TASK.md']);
  const allFiles = await walkFiles(fixtureRoot);
  const unexpectedFiles = allFiles.filter((rel) => !allowedPaths.has(rel));
  let filesChanged = 0;
  let linesChanged = 0;
  let testsMutated = false;

  for (const [rel, originalContent] of Object.entries(expectedFiles)) {
    let current = '';
    try { current = await readFile(path.join(fixtureRoot, rel), 'utf8'); } catch {}
    if (sha256(current) !== sha256(originalContent)) {
      filesChanged += 1;
      linesChanged += changedLineCount(originalContent, current);
      if (rel.startsWith('tests/')) testsMutated = true;
    }
  }

  const expectedTask = fixture.prompt + '\n';
  let currentTask = '';
  try { currentTask = await readFile(path.join(fixtureRoot, 'TASK.md'), 'utf8'); } catch {}
  const taskMutated = sha256(currentTask) !== sha256(expectedTask);

  // Explicit files are mandatory: `node --test tests` can succeed with
  // zero discovered tests on some Node versions and falsely score 3/3.
  const testFiles = Object.keys(expectedFiles)
    .filter((rel) => /^tests\/.+\.test\.[cm]?js$/.test(rel))
    .sort();
  if (testFiles.length === 0) throw new Error('FIXTURE_TESTS_MISSING:' + fixtureId);
  // This scorer is also run inside node --test. Never inherit the parent
  // test-runner context: child --test processes otherwise skip fixture tests
  // and can exit 0 without evaluating a single assertion.
  const fixtureEnv = fixtureChildEnvironment();
  // Reject tampered acceptance tests/tasks before executing any attacker-edited test.
  // A permitted outer runner must additionally sandbox untrusted solution code.
  if (testsMutated || taskMutated || unexpectedFiles.length > 0) {
    return { fixtureId, completed:false, testsPass:false, testCount:0, testExitCode:null,
      testsMutated, taskMutated, unexpectedFiles, filesChanged, linesChanged,
      stdoutTail:'', stderrTail:'BENCHMARK_UNTRUSTED_FIXTURE_REJECTED' };
  }
  const testRun = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...testFiles], {
    cwd: fixtureRoot,
    env: fixtureEnv,
    encoding: 'utf8',
    timeout: 120000,
  });
  const {testCount,testsPass} = verifyFixtureTapSummary(testRun);
  return {
    fixtureId,
    completed: testsPass && !testsMutated && !taskMutated && unexpectedFiles.length === 0,
    testsPass,
    testCount,
    testExitCode: testRun.status,
    testsMutated,
    taskMutated,
    unexpectedFiles,
    filesChanged,
    linesChanged,
    stdoutTail: String(testRun.stdout || '').slice(-1200),
    stderrTail: String(testRun.stderr || '').slice(-1200),
  };
}

export async function scoreLane({ root, lane } = {}) {
  if (!root || !lane) throw new Error('root_and_lane_required');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(String(lane))) throw new Error('BENCHMARK_LANE_INVALID');
  const manifest = await readManifest();
  const benchmarkRoot = path.resolve(root);
  if ((await lstat(benchmarkRoot)).isSymbolicLink()) throw new Error('BENCHMARK_SYMLINK_FORBIDDEN:root');
  const laneRoot = path.join(benchmarkRoot, lane);
  if ((await lstat(laneRoot)).isSymbolicLink()) throw new Error('BENCHMARK_SYMLINK_FORBIDDEN:lane');
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
    qualityPass: fixtures.every((item) => !item.testsMutated && !item.taskMutated && item.unexpectedFiles.length === 0),
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
    console.error('usage: node harness.mjs <seed|score> --root <new-isolated-dir> --lane <name>');
    process.exitCode = 2;
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}
