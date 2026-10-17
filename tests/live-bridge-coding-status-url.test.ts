import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,expect,it} from 'vitest';

const runtimeSource=readFileSync(new URL('../apps/tigeriq-live-bridge/server.mjs',import.meta.url),'utf8');
const updaterSource=readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url),'utf8');
const codingExpression=runtimeSource.match(/^const CODING=(.*);$/m)?.[1];
function resolved(env:Record<string,string|undefined>={}){
  if(!codingExpression)throw new Error('CODING_STATUS_EXPRESSION_MISSING');
  return runInNewContext(codingExpression,{process:{env}}) as string;
}

describe('PC01 Live Bridge standalone runtime Coding source',()=>{
  it('uses loopback that matches run-coding-lane.ps1 listener',()=>{
    expect(resolved()).toBe('http://127.0.0.1:8797/api/status');
  });
  it('retains explicit alternative endpoint configuration',()=>{
    expect(resolved({TIGERIQ_CODING_STATUS_URL:'http://100.97.23.87:8797/api/status'}))
      .toBe('http://100.97.23.87:8797/api/status');
  });
  it('uses loopback if configuration is blank',()=>{
    expect(resolved({TIGERIQ_CODING_STATUS_URL:'   '})).toBe('http://127.0.0.1:8797/api/status');
  });
  it('requires no relative imports because PC01 updater copies server.mjs only',()=>{
    expect(runtimeSource).not.toMatch(/^import\s+.*from\s+['"]\.\//m);
    expect(updaterSource).toContain('Copy-Item -LiteralPath $liveStatusBridgeSource -Destination $liveStatusBridgeRuntime -Force');
  });
});
