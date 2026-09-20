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

  it('updater fetches through control repo but mutates only dedicated runtime source',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain('git -C $controlRepo fetch origin main --prune');
    expect(src).toContain('worktree add --detach $runtimeRepo $targetSha');
    expect(src).toContain('git -C $runtimeRepo reset --hard $targetSha');
    expect(src).not.toMatch(/git -C \$controlRepo (?:checkout|merge|reset)/);
    expect(src).toContain("throw 'RUNTIME_SOURCE_DIRTY'");
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
});
