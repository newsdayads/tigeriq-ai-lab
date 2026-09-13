import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {startAutonomySupervisor} from '../apps/tigeriq-coding-lane/autonomy-supervisor.mjs';
import {startGithubIntake} from '../apps/tigeriq-core/github-intake.mjs';
import {startGithubCodingIntake} from '../apps/tigeriq-core/github-coding-intake.mjs';

test('legacy entry exits without loading credentials or starting the lane',()=>{
  const run=spawnSync(process.execPath,['apps/tigeriq-coding-lane/coding-entry.mjs'],{
    encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH,TIGERIQ_CODING_AUTO_MERGE:'true',TIGERIQ_ALLOW_PAID_AI:'true'}
  });
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(run.stdout).enabled,false);
});
test('direct worker invocation cannot bypass disabled entry',()=>{
  const run=spawnSync(process.execPath,['apps/tigeriq-coding-lane/coding-lane.mjs'],{
    encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH,TIGERIQ_CODING_AUTO_MERGE:'true'}
  });
  assert.equal(run.status,0,run.stderr);
  assert.equal(run.stdout,'');
});
test('intakes and job supervisor cannot create timers or touch external state',async()=>{
  const forbidden=()=>{throw new Error('unexpected external operation')};
  for(const start of [startGithubIntake,startGithubCodingIntake,startAutonomySupervisor]){
    const state=start({databaseUrl:'invalid',fetchImpl:forbidden,pool:{query:forbidden}});
    assert.equal(state.enabled,false);
    await state.stop();
  }
});
test('Windows entry points cannot load secrets or revive legacy execution',()=>{
  for(const name of ['run-coding-lane','install-coding-lane-task']){
    const source=readFileSync('scripts/tigeriq-core/'+name+'.ps1','utf8');
    assert.doesNotMatch(source,/Get-TigerIQSecret|Start-Process|Register-ScheduledTask|Start-ScheduledTask|while\s*\(/);
    assert.match(source,/exit 0/);
  }
});
