import {it as test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url),'utf8');

test('recovery helper is unique and does not duplicate updater code',()=>{
  expect(source.match(/function Resolve-DeployedSourceSha/g)).toHaveLength(1);
  expect(source.match(/function Runtime-Source-Dirty/g)).toHaveLength(1);
  expect(source.match(/function Restart-Core/g)).toHaveLength(1);
  expect(source.match(/function Gates-Pass/g)).toHaveLength(1);
  expect(source.length).toBeLessThan(60000);
});
test('installed metadata must match worktree and be a valid known commit',()=>{
  const block=source.slice(source.indexOf('function Resolve-DeployedSourceSha'),source.indexOf('function Runtime-Source-Dirty'));
  expect(block).toMatch(/meta\.sourcePath -ne \$runtimeRepo/);
  expect(block).toMatch(/recorded -notmatch '\^\[a-f0-9\]\{40\}\$'/);
  expect(block).toContain("Head $controlRepo ($recorded+'^{commit}')");
  expect(block).toMatch(/knownCommit -ne \$recorded/);
  expect(block).toContain('catch{return $checkedOutSha}');
});
test('stale marker gets reconciled before no-change short circuit',()=>{
  const resolve=source.indexOf('$local=Resolve-DeployedSourceSha $local $remote');
  const noChange=source.indexOf("Save-State @{result='NO_CHANGE'");
  const gates=source.indexOf('$gateSha=Resolve-GateSha $remote');
  const changed=source.indexOf('Get-Impact $changed',gates);
  expect(resolve).toBeGreaterThan(0);
  expect(noChange).toBeGreaterThan(resolve);
  expect(gates).toBeGreaterThan(noChange);
  expect(changed).toBeGreaterThan(gates);
});
test('old installed baseline uses existing guarded apply, restart and rollback paths',()=>{
  expect(source).toContain('Save-RuntimeSourceState $remote $previousRuntimeSha $gateSha');
  expect(source).toContain('if($impact.core){$coreHealth=Restart-Core $oldPid');
  expect(source).toContain('Invoke-RuntimeRollback $previousRuntimeSha $remote $impact');
  expect(source).toContain("if(-not $gateSha){Save-State @{result='WAIT_GATES'");
});
