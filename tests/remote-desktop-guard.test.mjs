import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MAX_OWNER_LEASE_MS, OBSERVATION_DIRECTORIES, argsHash, authorizeRemoteCall
} from '../apps/remote-desktop-guard/policy.mjs';
import {
  enforceRemoteToolCall
} from '../apps/remote-desktop-guard/runtime-gate.mjs';
import {
  patchDesktopCommanderServer, verifyDesktopCommanderServerPatched
} from '../apps/remote-desktop-guard/patch-desktop-commander.mjs';

const NOW=Date.parse('2026-09-25T00:01:00.000Z');
const tempDirs=[];

async function tempLeasePath() {
  const dir=await mkdtemp(join(tmpdir(),'tigeriq-rdc-guard-'));
  tempDirs.push(dir);
  return join(dir,'owner-lease.json');
}
function leaseFor(tool,args,{issued='2026-09-25T00:00:00.000Z',expires='2026-09-25T00:05:00.000Z'}={}) {
  return {version:1,leaseId:'OWNER-TEST-1',ownerAuthorized:true,tool,argsSha256:argsHash(args),issuedAt:issued,expiresAt:expires};
}
async function putLease(leasePath,lease) {
  await writeFile(leasePath,JSON.stringify(lease),'utf8');
}
afterEach(async()=>{ while(tempDirs.length) await rm(tempDirs.pop(),{recursive:true,force:true}); });

describe('Remote Desktop Commander hard runtime guard',()=>{
  it('passes only approved observation paths for read/list/search/health',()=>{
    expect(authorizeRemoteCall({tool:'read_file',args:{path:'D:\\TigerIQ\\Evidence\\x.txt'},now:NOW}))
      .toEqual({ok:true,reason:'READ_ONLY_DEFAULT_PASS'});
    expect(authorizeRemoteCall({tool:'list_directory',args:{path:'D:\\TigerIQ\\Logs'},now:NOW}))
      .toEqual({ok:true,reason:'READ_ONLY_DEFAULT_PASS'});
    expect(authorizeRemoteCall({tool:'start_search',args:{path:'D:\\TigerIQ\\Checkpoints'},now:NOW}))
      .toEqual({ok:true,reason:'READ_ONLY_DEFAULT_PASS'});
    expect(authorizeRemoteCall({tool:'list_processes',args:{},now:NOW}))
      .toEqual({ok:true,reason:'READ_ONLY_DEFAULT_PASS'});
    expect(authorizeRemoteCall({tool:'get_config',args:{},now:NOW}))
      .toEqual({ok:true,reason:'READ_ONLY_DEFAULT_PASS'});
  });

  it('blocks Secrets, broad TigerIQ roots, relative paths and URL reads',()=>{
    for (const args of [
      {path:'D:\\TigerIQ\\Secrets\\token.txt'},
      {path:'D:\\TigerIQ'},
      {path:'..\\Secrets\\token.txt'},
      {path:'https://127.0.0.1:8795/health',isUrl:true}
    ]) expect(authorizeRemoteCall({tool:'read_file',args,now:NOW})).toEqual({ok:false,reason:'READ_SCOPE_DENIED'});
  });

  it('fails closed for unauthorized PowerShell/CMD/Node/Python/Git/Vercel mutation',async()=>{
    const leasePath=await tempLeasePath();
    for (const command of [
      'powershell.exe -NoProfile -Command "Set-Content x y"',
      'cmd.exe /c del x',
      'node -e "require(\'fs\').writeFileSync(\'x\',\'y\')"',
      'python -c "open(\'x\',\'w\').write(\'y\')"',
      'git push origin main',
      'vercel deploy --prod',
      'vercel remove tigeriq --yes'
    ]) {
      const result=await enforceRemoteToolCall({isRemoteCall:true,tool:'start_process',args:{command,timeout_ms:5000},leasePath,now:NOW});
      expect(result).toEqual({ok:false,reason:'OWNER_AUTH_REQUIRED'});
    }
  });

  it('opens exactly one owner-authorized call then remains closed after restart/retry',async()=>{
    const leasePath=await tempLeasePath();
    const args={path:'D:\\TigerIQ\\Evidence\\guard-canary.txt',content:'ok',mode:'rewrite'};
    await putLease(leasePath,leaseFor('write_file',args));
    expect(await enforceRemoteToolCall({isRemoteCall:true,tool:'write_file',args,leasePath,now:NOW}))
      .toMatchObject({ok:true,reason:'OWNER_LEASE_VALID_SINGLE_USE',leaseId:'OWNER-TEST-1'});
    await expect(readFile(leasePath,'utf8')).rejects.toMatchObject({code:'ENOENT'});
    const claim=(await readdir(join(leasePath,'..'))).find((name)=>name.startsWith('owner-lease.json.claim-'));
    const receipt=JSON.parse(await readFile(join(join(leasePath,'..'),claim),'utf8'));
    expect(receipt).toMatchObject({consumed:true,decision:'ALLOW_ONCE'});
    expect(await enforceRemoteToolCall({isRemoteCall:true,tool:'write_file',args,leasePath,now:NOW}))
      .toEqual({ok:false,reason:'OWNER_AUTH_REQUIRED'});
  });

  it('scope mismatch or expiry consumes the lease fail-closed',async()=>{
    const leasePath=await tempLeasePath();
    const args={command:'echo approved',timeout_ms:1000};
    await putLease(leasePath,leaseFor('start_process',args));
    expect(await enforceRemoteToolCall({isRemoteCall:true,tool:'start_process',args:{...args,command:'echo changed'},leasePath,now:NOW}))
      .toMatchObject({ok:false,reason:'LEASE_ARGUMENT_SCOPE_MISMATCH'});
    await expect(readFile(leasePath,'utf8')).rejects.toMatchObject({code:'ENOENT'});

    await putLease(leasePath,leaseFor('start_process',args,{issued:'2026-09-24T23:40:00.000Z',expires:'2026-09-24T23:45:00.000Z'}));
    expect(await enforceRemoteToolCall({isRemoteCall:true,tool:'start_process',args,leasePath,now:NOW}))
      .toMatchObject({ok:false,reason:'LEASE_EXPIRED_OR_NOT_ACTIVE'});
    await expect(readFile(leasePath,'utf8')).rejects.toMatchObject({code:'ENOENT'});
  });

  it('enforces lease max lifetime and exact full argument hash',()=>{
    const args={command:'echo bounded',timeout_ms:1000,shell:'cmd.exe'};
    const tooLong=leaseFor('start_process',args,{issued:'2026-09-25T00:00:00.000Z',expires:new Date(Date.parse('2026-09-25T00:00:00.000Z')+MAX_OWNER_LEASE_MS+1).toISOString()});
    expect(authorizeRemoteCall({tool:'start_process',args,lease:tooLong,now:NOW})).toMatchObject({ok:false,reason:'LEASE_BOUNDS_INVALID'});
    expect(authorizeRemoteCall({tool:'start_process',args:{...args,timeout_ms:2000},lease:leaseFor('start_process',args),now:NOW}))
      .toMatchObject({ok:false,reason:'LEASE_ARGUMENT_SCOPE_MISMATCH'});
  });

  it('forbids remote security config mutation even when a lease file exists',async()=>{
    const leasePath=await tempLeasePath();
    const args={key:'blockedCommands',value:['x']};
    await putLease(leasePath,leaseFor('set_config_value',args));
    expect(await enforceRemoteToolCall({isRemoteCall:true,tool:'set_config_value',args,leasePath,now:NOW}))
      .toEqual({ok:false,reason:'REMOTE_CONFIG_MUTATION_FORBIDDEN'});
    expect(JSON.parse(await readFile(leasePath,'utf8'))).toMatchObject({leaseId:'OWNER-TEST-1'});
  });

  it('unknown remote tools fail closed while local calls remain unchanged',async()=>{
    expect(await enforceRemoteToolCall({isRemoteCall:true,tool:'future_mutator',args:{},now:NOW}))
      .toEqual({ok:false,reason:'UNKNOWN_TOOL_FAIL_CLOSED'});
    expect(await enforceRemoteToolCall({isRemoteCall:false,tool:'start_process',args:{command:'echo local'},now:NOW}))
      .toEqual({ok:true,reason:'LOCAL_CALL_UNCHANGED'});
  });

  it('patches Desktop Commander dispatcher idempotently and rejects anchor drift',()=>{
    const fixture=[
      "import path from 'path';",
      'async function handleCallToolRequest(request) {',
      '    const { name, arguments: args } = request.params;',
      '    const isRemoteCall = true;',
      '        setCurrentCallIsRemote(isRemoteCall);',
      '}'
    ].join('\n');
    const once=patchDesktopCommanderServer(fixture);
    const twice=patchDesktopCommanderServer(once);
    expect(twice).toBe(once);
    expect(verifyDesktopCommanderServerPatched(once)).toBe(true);
    expect(()=>patchDesktopCommanderServer('unexpected upstream')).toThrow('DESKTOP_COMMANDER_0_2_51_ANCHOR_MISMATCH');
  });

  it('keeps the observation allowlist narrow and excludes Secrets',()=>{
    expect(OBSERVATION_DIRECTORIES.length).toBeGreaterThan(0);
    expect(OBSERVATION_DIRECTORIES.some((x)=>/\\Secrets(?:\\|$)/i.test(x))).toBe(false);
  });
});
