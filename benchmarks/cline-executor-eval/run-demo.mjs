// TigerIQ #5097 native-compatible scorer demo: failing baseline -> 3/3 reference fixes.
// Reference solutions are demonstration only: NO LLM, NV09, Cline or paid provider.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {changedLineCount, seedLane, scoreLane} from './harness.mjs';
import {applyDemoReferenceSolutions} from './reference-solutions.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'tigeriq-5097-e2e-'));
try {
  const text = 'alpha\nbeta\ngamma';
  const actual = changedLineCount(text, '// note\n' + text);
  assert.equal(actual, 1, 'inserted line must not inflate shifted line metrics');

  const seeded = await seedLane({root, lane: 'scorer-reference-demo'});
  assert.equal(seeded.fixtures.length, 3);
  const baseline = await scoreLane({root, lane: 'scorer-reference-demo'});
  assert.equal(baseline.total, 3);
  assert.equal(baseline.completed, 0, 'unsolved fixtures must fail the baseline');
  assert(baseline.fixtures.every(row => row.testCount >= 2 && row.testsPass === false));

  const source = path.join(seeded.fixtures[0].root, 'src', 'parse-count.mjs');
  const original = await readFile(source, 'utf8');
  await writeFile(source, '// one inserted comment\n' + original, 'utf8');
  const inserted = await scoreLane({root, lane: 'scorer-reference-demo'});
  const delta = inserted.fixtures.find(row => row.fixtureId === 'strict-count-parser');
  assert.equal(delta.filesChanged, 1);
  assert.equal(delta.linesChanged, 1);
  assert.equal(delta.testsMutated, false);

  const patches = await applyDemoReferenceSolutions(seeded.fixtures);
  const fixed = await scoreLane({root, lane: 'scorer-reference-demo'});
  assert.equal(fixed.total, 3);
  assert.equal(fixed.completed, 3, 'all fixture tests must pass');
  assert.equal(fixed.qualityPass, true);
  assert(fixed.fixtures.every(row => row.completed && row.testsPass &&
    row.testExitCode === 0 && row.testCount >= 2 &&
    row.filesChanged === 1 && row.linesChanged >= 1 &&
    !row.testsMutated && !row.taskMutated && row.unexpectedFiles.length === 0));

  const result = {
    workOrder: 'GH-5097',
    status: 'PASS_SCORER_END_TO_END_3_OF_3',
    agentExecuted: false,
    node: process.version,
    baseline: {completed: baseline.completed, total: baseline.total},
    shiftedLineCount: {expected: 1, actual, scoredSourceLinesChanged: delta.linesChanged},
    referencePatches: patches,
    verified: {
      completed: fixed.completed, total: fixed.total, qualityPass: fixed.qualityPass,
      fixtures: fixed.fixtures.map(row => ({
        fixtureId: row.fixtureId, completed: row.completed, testsPass: row.testsPass,
        testCount: row.testCount, exitCode: row.testExitCode,
        filesChanged: row.filesChanged, linesChanged: row.linesChanged,
        testsMutated: row.testsMutated, taskMutated: row.taskMutated,
        unexpectedFiles: row.unexpectedFiles
      }))
    },
    note: 'Known-good reference patches only; not an NV09/Cline agent attestation.'
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await rm(root, {recursive: true, force: true});
}
