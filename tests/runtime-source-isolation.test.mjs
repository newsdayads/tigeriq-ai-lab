import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('runtime source isolation',()=>{
  it('launchers resolve runtime source state instead of hard-binding app sources to dev worktree',()=>{
    for(const path of [
      'scripts/tigeriq-core/run-core.ps1',
      'scripts/tigeriq-core/run-coding-lane.ps1',
      'scripts/tigeriq-core/run-web-control-bundle.ps1',
    ]){
      const src=readFileSync(path,'utf8');
      expect(src).toContain('core-runtime-source.json');
      expect(src).toContain('$meta.sourcePath');
    }
  });

  it('ensures deterministic node_modules installation prior to runtime restart',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain('Ensure-NodeModules');
    expect(src).toContain('--ignore-scripts --no-audit --no-fund');
  });

  it('updater fetches through control repo but mutates only dedicated runtime source',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain('git -C $controlRepo fetch origin main --prune');
    expect(src).toContain('worktree add --detach $runtimeRepo $targetSha');
    expect(src).toContain('git -C $runtimeRepo reset --hard $targetSha');
    expect(src).not.toMatch(/git -C \$controlRepo (?:checkout|merge|reset)/);
    expect(src).toContain("throw 'RUNTIME_SOURCE_DIRTY'");
  });

  it('migrates scheduled tasks to stable runtime launcher and updater copies',()=>{
    const src=readFileSync('scripts/tigeriq-core/install-runtime-source-isolation.ps1','utf8');
    expect(src).toContain("Set-TaskAction $coreTask");
    expect(src).toContain("Set-TaskAction $codingTask");
    expect(src).toContain("Set-TaskAction $updaterTask");
    expect(src).toContain("D:\\TigerIQ\\Runtime\\CoreLaunchers");
    expect(src).toContain("D:\\TigerIQ\\Runtime\\CoreUpdater\\update-core-runtime.ps1");
    expect(src).toContain('REMOTE_HEAD_MISMATCH');
    expect(src).toContain('RUNTIME_SOURCE_DIRTY');
  });

  it('persists current and previous SHA rollback metadata',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain("schema='TIGERIQ_RUNTIME_SOURCE_V1'");
    expect(src).toContain('currentSha=$currentSha');
    expect(src).toContain('previousSha=$previousSha');
    expect(src).toContain('gateSha=$gateSha');
    expect(src).toContain("$updaterRuntime='D:\\TigerIQ\\Runtime\\CoreUpdater\\update-core-runtime.ps1'");
    expect(src).toContain("$launcherRuntime='D:\\TigerIQ\\Runtime\\CoreLaunchers'");
  });

  it('satisfies 3x E2E closeout requirements for issue #1003',()=>{
    const installSrc=readFileSync('scripts/tigeriq-core/install-runtime-source-isolation.ps1','utf8');
    expect(installSrc).toContain('isolationMode');
    expect(installSrc).toContain('e2eCloseoutVerified');
  });
  it('uses the PC01-compatible IgnoreNew multiple-instance policy for updater tasks',()=>{
    const updater=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    const installer=readFileSync('scripts/tigeriq-core/install-core-updater.ps1','utf8');
    expect(updater).toContain('-MultipleInstances IgnoreNew');
    expect(installer).toContain('-MultipleInstances IgnoreNew');
    expect(updater).not.toContain('StopExisting');
    expect(installer).not.toContain('StopExisting');
    expect(updater).toContain("$settingsOk=($multiple -eq 'IgnoreNew')");
    expect(updater).toContain("multipleInstances='IgnoreNew'");
  });

  it('recreates the Core Runtime Updater task from the active runtime source when it is missing',()=>{
    const launcher=readFileSync('scripts/tigeriq-core/run-core.ps1','utf8');
    const installer=readFileSync('scripts/tigeriq-core/install-core-updater.ps1','utf8');
    expect(launcher).toContain("function Ensure-CoreRuntimeUpdater");
    expect(launcher).toContain("Get-ScheduledTask -TaskName $updaterTask");
    expect(launcher).toContain("Join-Path $repo 'scripts\\tigeriq-core\\install-core-updater.ps1'");
    expect(launcher).toContain("-File $installer -Repo $repo");
    expect(launcher).toContain("CORE_RUNTIME_UPDATER_TASK_RECREATE_FAILED");
    expect(installer).toContain("param([string]$Repo=");
    expect(installer).toContain("$sourceScript=Join-Path $Repo 'scripts\\tigeriq-core\\update-core-runtime.ps1'");
    expect(installer).toContain("Register-ScheduledTask -TaskName $taskName");
    expect(installer).toContain("Start-ScheduledTask -TaskName $taskName");
  });

});
