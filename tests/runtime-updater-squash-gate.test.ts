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

  it('ensures node_modules via deterministic package-lock install with scripts disabled and fails closed if invalid or failed',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain('function Ensure-NodeModules');
    expect(src).toContain('npm --prefix $repoPath ci --ignore-scripts --no-audit --no-fund');
    expect(src).toContain("throw 'NPM_CI_FAILED'");
    expect(src).toContain("throw 'PACKAGE_LOCK_MISSING'");
    expect(src).toContain('Ensure-NodeModules $runtimeRepo');
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
  it('gates only OpenClaw changes on functional canary and keeps unrelated updater changes moving',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain('function Reconcile-OpenClawRuntime([string]$installedSha)');
    expect(src).toContain("reason='terminal_canary_blocked'");
    expect(src).toContain("OPENCLAW_DEGRADED_NONBLOCKING");
    expect(src).toContain('if($impact.openclaw){');
    expect(src).not.toContain('if($impact.updater -or $impact.openclaw)');
    expect(src).toContain("throw ('OPENCLAW_FUNCTIONAL_CANARY_FAILED:'+ $why)");
    expect(src).toContain('if($impact.openclaw){Save-OpenClawAppliedState $tree}');
    expect(src).toContain('if($impact.openclaw -and $null -eq $openclawCanary){$openclawCanary=Invoke-OpenClawCanary $remote (OpenClaw-TreeSha)}');
  });

  it('recreates a missing Core Runtime Updater from the active runtime repo',()=>{
    const launcher=readFileSync('scripts/tigeriq-core/run-core.ps1','utf8');
    const installer=readFileSync('scripts/tigeriq-core/install-core-updater.ps1','utf8');
    expect(launcher).toContain('function Ensure-CoreRuntimeUpdater');
    expect(launcher).toContain("Get-ScheduledTask -TaskName $updaterTask");
    expect(launcher).toContain("-File $installer -Repo $repo");
    expect(launcher).toContain("CORE_RUNTIME_UPDATER_TASK_RECREATE_FAILED");
    expect(installer).toContain("param([string]$Repo='D:\\TigerIQ\\Workspace\\tigeriq-ai-lab')");
    expect(installer).toContain("$sourceScript=Join-Path $Repo 'scripts\\tigeriq-core\\update-core-runtime.ps1'");
    expect(installer).toContain('Register-ScheduledTask -TaskName $taskName');
    expect(installer).toContain('Start-ScheduledTask -TaskName $taskName');
  });

});
