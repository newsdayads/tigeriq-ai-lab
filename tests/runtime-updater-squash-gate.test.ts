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

  it('syncs the Web Control runtime bundle before Web-only restart and after rollback',()=>{
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
});
