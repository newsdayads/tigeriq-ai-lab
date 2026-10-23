import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { advancePreview, GRID_SIZE, initialState } from '../dist/preview.js';
import { gridCellSize } from '../dist/render.js';
test('reset state and board geometry are deterministic', () => {
  assert.deepEqual(initialState(), { x: 1, y: 4, heading: 0, commands: 0 });
  assert.equal(GRID_SIZE, 6);
  assert.equal(gridCellSize(480), 80);
  assert.throws(() => gridCellSize(0), RangeError);
});
test('left and right rotate without mutating the original object', () => {
  const initial = initialState();
  assert.deepEqual(advancePreview(initial, 'left'), { ...initial, heading: 3, commands: 1 });
  assert.deepEqual(advancePreview(initial, 'right'), { ...initial, heading: 1, commands: 1 });
  assert.equal(initial.heading, 0);
});
test('forward movement remains inside the board', () => {
  let robot = initialState();
  for (let step = 0; step < 12; step += 1) robot = advancePreview(robot, 'forward');
  assert.equal(robot.y, 0);
  assert.equal(robot.x, 1);
  assert.equal(robot.commands, 12);
});
test('unsupported commands fail closed', () => {
  assert.throws(() => advancePreview(initialState(), 'teleport'), /Unsupported/);
});
test('static HTML and JS artifacts exist and reference only local assets', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const main = await readFile(new URL('../dist/main.js', import.meta.url), 'utf8');
  assert.match(html, /id="board"/);
  assert.match(html, /\.\/main\.js/);
  // G06 production entrypoint draws with drawGame, not the historical G04 preview.
  assert.match(main, /drawGame/);
  assert.match(main, /\.\/levels\/draw\.js/);
  assert.doesNotMatch(html, /https?:\/\//);
});
