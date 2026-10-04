import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const markerPath = 'release/3840-retry-one-shot.txt';
const expected = 'TIGERIQ_LIVE_3840_RETRY_TRUE_PRODUCTION\n';

let added = false;
let modeOk = false;
let bytesOk = false;

try {
  const addedPath = execFileSync(
    'git',
    ['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=A', '-r', 'HEAD', '--', markerPath],
    { encoding: 'utf8' }
  ).trim();
  added = addedPath === markerPath;

  const treeEntry = execFileSync('git', ['ls-tree', 'HEAD', '--', markerPath], { encoding: 'utf8' }).trim();
  modeOk = treeEntry.startsWith('100644 blob ');

  bytesOk = readFileSync(new URL('../' + markerPath, import.meta.url), 'utf8') === expected;
} catch {
  process.exit(0);
}

process.exit(added && modeOk && bytesOk ? 1 : 0);
