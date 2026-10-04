import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

describe('runtime updater squash merge gate resolution',()=>{
  it('refreshes canonical main into origin/main with an explicit refspec and verifies FETCH_HEAD',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain("fetch origin '+refs/heads/main:refs/remotes/origin/main' --prune");
    expect(src).toContain("$remote=Head $controlRepo 'refs/remotes/origin/main'");
    expect(src).toContain("$fetchHead=Head $controlRepo 'FETCH_HEAD'");
    expect(src).toContain("throw 'FETCH_HEAD_MISSING'");
    expect(src).toContain("throw 'REMOTE_MAIN_FETCH_HEAD_MISMATCH'");
    expect(src).not.toContain('fetch origin main --prune');
  });

  it('falls back from merge SHA to associated PR head SHA',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain('function Resolve-GateSha');
    expect(src).toContain('commits/$remote/pulls');
    expect(src).toContain('Gates-Pass $head');
    expect(src).toContain('gateSha=$gateSha');
  });

  it('keeps Runtime Updater gate independent from Vercel web-hosting checks',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    const start=src.indexOf('function Gates-Pass');
    const end=src.indexOf('function Resolve-GateSha');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const gate=src.slice(start,end);
    expect(gate).toContain("'CI'");
    expect(gate).toContain("'WO-014 Queue Hygiene'");
    expect(gate).not.toContain('Vercel');
  });

  it('stages Web Control bootstrap files before Web-only restart and after rollback',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain("else{'D:\\TigerIQ\\Runtime\\WebControl24x7'}");
    expect(src).toContain('function Sync-WebRuntime');
    expect(src).toContain("src='apps\\tigeriq-core\\web-control-server.mjs'");
    expect(src).toContain("src='apps\\tigeriq-core\\web-control-truth.js'");
    expect(src).toContain("src='apps\\tigeriq-core\\web-control.html'");
    expect(src).toContain("src='scripts\\tigeriq-core\\run-web-control-bundle.ps1'");
    expect(src).toContain("if($impact.web){Sync-WebRuntime;$webHealth=Restart-ServiceTask");
    expect(src).toContain("if(-not $CanaryMode -and (Task-Exists $webTask)){Sync-WebRuntime;$null=Restart-ServiceTask");
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
    expect(src).toContain("else{'D:\\TigerIQ\\Workspace\\tigeriq-ai-lab'}");
    expect(src).toContain("else{'D:\\TigerIQ\\Runtime\\CoreSource'}");
    expect(src).toContain('worktree add --detach $runtimeRepo $targetSha');
    expect(src).toContain('git -C $runtimeRepo status --porcelain');
    expect(src).toContain('git -C $runtimeRepo reset --hard $targetSha');
    expect(src).toContain('git -C $runtimeRepo reset --hard $previousRuntimeSha');
    expect(src).toContain('core-runtime-source.json');
    expect(src).toContain('Sync-Launchers');
    expect(src).not.toContain('checkout -B core-runtime-sync origin/main');
    expect(src).not.toContain('merge --ff-only origin/main');
  });

  it('synthetic candidate failure executes the updater rollback handler and restores known-good runtime',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8').replace(/\r\n/g,'\n');
    const candidateTry=src.indexOf('$previousRuntimeSha=$local\n    try{\n      Ensure-RuntimeSource $remote\n      Ensure-NodeModules $runtimeRepo');
    const candidateCatch=src.indexOf('$null=Invoke-RuntimeRollback $previousRuntimeSha $remote $impact');
    expect(candidateTry).toBeGreaterThanOrEqual(0);
    expect(candidateCatch).toBeGreaterThan(candidateTry);
    expect(src).toContain('function Invoke-RuntimeRollback');
    expect(src).toContain("throw ('ROLLED_BACK:'+ $failure)");

    const dir=mkdtempSync(join(tmpdir(),'tigeriq-updater-rollback-'));
    const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
    try{
      git('init');
      git('config','user.email','canary@tigeriq.local');
      git('config','user.name','TigerIQ Canary');
      writeFileSync(join(dir,'runtime.txt'),'known-good\n');
      git('add','runtime.txt');git('commit','-m','known good');
      const previousSha=git('rev-parse','HEAD');
      writeFileSync(join(dir,'runtime.txt'),'candidate-bad\n');
      git('add','runtime.txt');git('commit','-m','candidate');
      const candidateSha=git('rev-parse','HEAD');
      expect(candidateSha).not.toBe(previousSha);

      const powershell=process.platform==='win32'?'powershell.exe':'pwsh';
      const raw=execFileSync(powershell,[
        '-NoProfile','-File','scripts/tigeriq-core/update-core-runtime.ps1',
        '-RollbackCanaryRuntimeRepo',dir,
        '-RollbackCanaryPreviousSha',previousSha,
        '-RollbackCanaryCandidateSha',candidateSha,
      ],{encoding:'utf8'});
      const line=raw.trim().split(/\r?\n/).filter(Boolean).at(-1);
      const evidence=JSON.parse(String(line));

      expect(evidence.result).toBe('ROLLED_BACK');
      expect(evidence.failure).toBe('SYNTHETIC_CANDIDATE_FAILURE');
      expect(evidence.candidateHeadBeforeFailure).toBe(candidateSha);
      expect(evidence.rollback.restoredHead).toBe(previousSha);
      expect(evidence.rollback.restartActions).toEqual(['core','web','coding']);
      expect(git('rev-parse','HEAD')).toBe(previousSha);
      expect(readFileSync(join(dir,'runtime.txt'),'utf8').replace(/\r\n/g,'\n')).toBe('known-good\n');

      const runtimeState=JSON.parse(readFileSync(join(dir,'.canary-core-runtime-source.json'),'utf8'));
      expect(runtimeState.currentSha).toBe(previousSha);
      expect(runtimeState.previousSha).toBe(candidateSha);
      expect(runtimeState.gateSha).toBe(previousSha);
    } finally {
      rmSync(dir,{recursive:true,force:true});
    }
  },15000);

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

  it('persists GitHub REST cooldown across updater loops/restarts without App Chrome GitHub mutation',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain("$githubApiBackoffState='D:\\TigerIQ\\State\\github-api-rate-limit-backoff.json'");
    expect(src).toContain('function Load-GithubApiBackoff');
    expect(src).toContain('function Save-GithubApiBackoff');
    expect(src).toContain("schema='TIGERIQ_GITHUB_API_BACKOFF_V1'");
    expect(src).toContain('function Test-GithubApiBackoff');
    expect(src).toContain('function Set-GithubApiBackoffFromText');
    expect(src).toContain('function Invoke-GithubApiJson');
    const openclawReport=src.slice(src.indexOf('function Report-OpenClawCanary'),src.indexOf('function Invoke-OpenClawCanary'));
    expect(openclawReport).toContain('if(Test-GithubApiBackoff){return $false}');
    expect(openclawReport).toContain('$null=Set-GithubApiBackoffFromText $raw');
    const appReport=src.slice(src.indexOf('function Report-AppChromeResume'),src.indexOf('function Invoke-AppChromeOwnerResume'));
    expect(appReport).toContain('return $false');
    expect(appReport).not.toContain('gh issue comment');
    const helper=src.slice(src.indexOf('function Invoke-AppChromeZeroTouchHelper'),src.indexOf('function Task-Exists'));
    expect(helper).toContain('APP_CHROME_EXTERNAL_LOCAL_ONLY');
    expect(helper).not.toContain('powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $appChromeZeroTouchScript');
    expect(src).toContain('Invoke-GithubApiJson "repos/newsdayads/tigeriq-ai-lab/actions/runs?head_sha=$sha&status=completed&per_page=30"');
    expect(src).toContain('Gates-Pass $head');
  });

  it('keeps App Chrome observation-only and removes Core/bootstrap self-heal mutation',()=>{
    const updater=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    const watchdog=readFileSync('scripts/tigeriq-core/bootstrap-watchdog.ps1','utf8');
    expect(updater).toContain("$appChromeExternalLocalOnly=$true");
    const sync=updater.slice(updater.indexOf('function Sync-AppChromeTaskBlueprint'),updater.indexOf('function Retire-LegacyOpenClawLifecycleOwner'));
    expect(sync).toContain('APP_CHROME_EXTERNAL_LOCAL_ONLY');
    expect(sync).not.toContain('Export-ScheduledTask');
    const resume=updater.slice(updater.indexOf('function Invoke-AppChromeOwnerResume'),updater.indexOf('function Invoke-AppChromeZeroTouchHelper'));
    expect(resume).toContain('APP_CHROME_EXTERNAL_LOCAL_ONLY');
    expect(resume).not.toContain('/api/resume');
    expect(resume).not.toContain('/api/start-all');
    const health=updater.slice(updater.indexOf('function Ensure-AppChromeTransportHealth'),updater.indexOf('function Runtime-Watchdog'));
    expect(health).toContain("action='observe_only'");
    expect(health).not.toContain('Stop-ScheduledTask');
    expect(health).not.toContain('Start-ScheduledTask');
    expect(watchdog).toContain("$appChromeExternalLocalOnly=$true");
    const ensure=watchdog.slice(watchdog.indexOf('function Ensure-AppChromeTask'),watchdog.indexOf('while($true)'));
    expect(ensure).toContain('APP_CHROME_EXTERNAL_LOCAL_ONLY');
    expect(ensure).not.toContain('Register-ScheduledTask');
    expect(ensure).not.toContain('Enable-ScheduledTask');
    expect(watchdog).not.toContain("@{key='appchrome';task=$appChromeTask;ports=@(8798,8799)}");
  });

});
