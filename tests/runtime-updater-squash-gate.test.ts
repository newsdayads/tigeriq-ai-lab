import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('runtime updater squash merge gate resolution',()=>{
  it('falls back from merge SHA to associated PR head SHA',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain('function Resolve-GateSha');
    expect(src).toContain('commits/$remote/pulls');
    expect(src).toContain('Gates-Pass $head');
    expect(src).toContain('gateSha=$gateSha');
  });

  it('stages Web Control bootstrap files before Web-only restart and after rollback',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain("$webRuntime='D:\\TigerIQ\\Runtime\\WebControl24x7'");
    expect(src).toContain('function Sync-WebRuntime');
    expect(src).toContain("src='apps\\tigeriq-core\\web-control-server.mjs'");
    expect(src).toContain("src='apps\\tigeriq-core\\web-control-truth.js'");
    expect(src).toContain("src='apps\\tigeriq-core\\web-control.html'");
    expect(src).toContain("src='scripts\\tigeriq-core\\run-web-control-bundle.ps1'");
    expect(src).toContain("if($impact.web){Sync-WebRuntime;$webHealth=Restart-ServiceTask");
    expect(src).toContain("if($impact.web -and (Task-Exists $webTask)){Sync-WebRuntime;$null=Restart-ServiceTask");
  });

  it('restarts the full Core scheduled task so updated launcher logic is reloaded',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    const start=src.indexOf('function Restart-Core');
    const end=src.indexOf('function Restart-ServiceTask');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const restartCore=src.slice(start,end);
    expect(restartCore).toContain("if(-not(Task-Exists $coreTask)){throw ('TASK_MISSING:'+ $coreTask)}");
    expect(restartCore).toContain('Stop-ScheduledTask -TaskName $coreTask');
    expect(restartCore).toContain('Stop-CoreProcesses');
    expect(restartCore).toContain('Start-ScheduledTask -TaskName $coreTask');
    expect(restartCore).toContain('$previousPid=if($null-ne$oldPid){[int]$oldPid}else{Get-CorePid}');
    expect(restartCore).toContain('$newPid=Get-CorePid');
    expect(restartCore).toContain('[int]$newPid-ne[int]$previousPid');
  });

  it('isolates runtime source from the developer worktree with SHA rollback',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain("$controlRepo='D:\\TigerIQ\\Workspace\\tigeriq-ai-lab'");
    expect(src).toContain("$runtimeRepo='D:\\TigerIQ\\Runtime\\CoreSource'");
    expect(src).toContain('worktree add --detach $runtimeRepo $targetSha');
    expect(src).toContain('git -C $runtimeRepo status --porcelain');
    expect(src).toContain('git -C $runtimeRepo reset --hard $targetSha');
    expect(src).toContain('git -C $runtimeRepo reset --hard $previousRuntimeSha');
    expect(src).toContain('core-runtime-source.json');
    expect(src).toContain('Sync-Launchers');
    expect(src).not.toContain('checkout -B core-runtime-sync origin/main');
    expect(src).not.toContain('merge --ff-only origin/main');
  });

  it('self-syncs every current/future web-control asset plus workforce registry before launch',()=>{
    const launcher=readFileSync('scripts/tigeriq-core/run-web-control-bundle.ps1','utf8');
    expect(launcher).toContain("core-runtime-source.json");
    expect(launcher).toContain("$sourceRoot=Join-Path $repo 'apps\\tigeriq-core'");
    expect(launcher).toContain("$_.Name -like 'web-control-*.js'");
    expect(launcher).toContain("$_.Name -like 'web-control-*.css'");
    expect(launcher).toContain("$_.Name -eq 'web-control-server.mjs'");
    expect(launcher).toContain("$_.Name -eq 'web-control.html'");
    expect(launcher).toContain("$_.Name -eq 'workforce-registry.mjs'");
    expect(launcher).toContain('Copy-Item -LiteralPath $asset.FullName -Destination $tmp -Force');
    expect(launcher).toContain('Move-Item -LiteralPath $tmp -Destination $target -Force');
  });
});
