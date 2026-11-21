import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {ownerCliNeedsUserSession,validateOwnerCliBridgeRequest} from './owner-cli-user-bridge.mjs';

const requestId='d06bcbee-a25f-426c-b5c8-26c6e00722ca';
const nowMs=Date.parse('2026-11-22T02:00:00.000Z');
const base={schema:'TIGERIQ_OWNER_CLI_BRIDGE_V1',requestId,
  createdAt:new Date(nowMs).toISOString()};
describe('Owner CLI user session security gates',()=>{
  it('detects SYSTEM and systemprofile without treating user as privileged',()=>{
    expect(ownerCliNeedsUserSession({USERNAME:'SYSTEM'})).toBe(true);
    expect(ownerCliNeedsUserSession({LOCALAPPDATA:'C:\\Windows\\System32\\config\\systemprofile\\AppData\\Local'})).toBe(true);
    expect(ownerCliNeedsUserSession({USERNAME:'wdragons12x',LOCALAPPDATA:'C:\\Users\\wdragons12x\\AppData\\Local'})).toBe(false);
  });
  it('permits only explicit quota or scoped read-only execution',()=>{
    expect(validateOwnerCliBridgeRequest({...base,action:'quota'},{nowMs})).toMatchObject({action:'quota',requestId});
    expect(validateOwnerCliBridgeRequest({...base,action:'execute',provider:'antigravity',model:'gemini-3.8-flash-low',prompt:'Tóm tắt',timeoutMs:15000},{nowMs}))
      .toMatchObject({action:'execute',provider:'antigravity',model:'gemini-3.8-flash-low'});
  });
  it('rejects shell, admin and malformed provider/model',()=>{
    for(const bad of [
      {action:'shell',prompt:'whoami'},
      {action:'admin',provider:'codex'},
      {action:'execute',provider:'powershell',model:'abc',prompt:'x',timeoutMs:6000},
      {action:'execute',provider:'codex',model:'../../exe',prompt:'x',timeoutMs:6000},
      {action:'execute',provider:'codex',model:'gpt',prompt:'x',timeoutMs:999999},
      {action:'execute',provider:'codex',model:'gpt',prompt:'',timeoutMs:8000},
    ])expect(()=>validateOwnerCliBridgeRequest({...base,...bad},{nowMs})).toThrow();
  });
  it('rejects stale or forged requests',()=>{
    expect(()=>validateOwnerCliBridgeRequest({...base,createdAt:'2026-11-01T00:00:00Z',action:'quota'},{nowMs})).toThrow('STALE');
    expect(()=>validateOwnerCliBridgeRequest({...base,requestId:'not-uuid',action:'quota'},{nowMs})).toThrow('INVALID');
  });
  it('never runs user model CLIs under SYSTEM or grants a full-access sandbox',()=>{
    const quota=readFileSync(new URL('./owner-cli-quota-probe.mjs',import.meta.url),'utf8');
    const exec=readFileSync(new URL('./owner-cli-dispatch.mjs',import.meta.url),'utf8');
    const worker=readFileSync(new URL('./owner-cli-user-worker.mjs',import.meta.url),'utf8');
    const install=readFileSync(new URL('../../scripts/pc-worker/install-owner-cli-user-session.ps1',import.meta.url),'utf8');
    expect(quota).toContain('if(ownerCliNeedsUserSession())');
    expect(exec).toContain("['exec', '--sandbox', 'read-only'");
    expect(exec).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(worker).toContain('verifyOwnerWorkerIdentity()');
    expect(install).toContain('-RunLevel Limited');
    expect(install).not.toContain('-RunLevel Highest');
  });
});
