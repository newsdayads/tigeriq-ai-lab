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

  it('syncs the complete Web Control runtime bundle before Web-only restart and after rollback',()=>{
    const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
    expect(src).toContain("$webRuntime='D:\\TigerIQ\\Runtime\\WebControl24x7'");
    expect(src).toContain('function Sync-WebRuntime');
    for(const asset of [
      'web-control-server.mjs','web-control-truth.js','web-control.html',
      'web-control-unified.js','web-control-workforce.js','web-control-routing.js',
      'web-control-unified.css','web-control-mobile.css','web-control-workforce.css','web-control-routing.css',
    ]) expect(src).toContain(`src='apps\\tigeriq-core\\${asset}'`);
    expect(src).toContain("src='scripts\\tigeriq-core\\run-web-control-bundle.ps1'");
    expect(src).toContain("if($impact.web){Sync-WebRuntime;$webHealth=Restart-ServiceTask");
    expect(src).toContain("if($impact.web -and (Task-Exists $webTask)){Sync-WebRuntime;$null=Restart-ServiceTask");
  });
});
