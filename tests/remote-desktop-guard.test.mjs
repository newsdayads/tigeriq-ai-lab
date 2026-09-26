import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AUTHORIZATION_TOOL, MAX_OWNER_LEASE_MS, OBSERVATION_DIRECTORIES, argsHash, authorizeRemoteCall, requiredRiskClass
} from '../apps/remote-desktop-guard/policy.mjs';
import {
  enforceRemoteToolCall, filterRemoteToolDefinitions, installOwnerLeaseFromAuthorization, verifyRealReadScope
} from '../apps/remote-desktop-guard/runtime-gate.mjs';
import {
  patchDesktopCommanderServer, verifyDesktopCommanderServerPatched
} from '../apps/remote-desktop-guard/patch-desktop-commander.mjs';
import {
  patchRemoteLauncher, verifyRemoteLauncherPatched
} from '../apps/remote-desktop-guard/patch-remote-launcher.mjs';

const NOW=Date.parse('2026-09-25T00:01:00.000Z');
const tempDirs=[];

async function tempLeasePath() {
  const dir=await mkdtemp(join(tmpdir(),'tigeriq-rdc-guard-'));
  tempDirs.push(dir);
  return join(dir,'owner-lease.json');
}
function leaseFor(tool,args,{issued='2026-09-25T00:00:00.000Z',expires='2026-09-25T00:05:00.000Z'}={}) {
  return {version:1,leaseId:'OWNER-TEST-1',ownerAuthorized:true,authorizationUrl:'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/comments/123456',tool,argsSha256:argsHash(args),riskClass:requiredRiskClass(tool,args),issuedAt:issued,expiresAt:expires};
}
async function putLease(leasePath,lease) {
  await writeFile(leasePath,JSON.stringify(lease),'utf8');
}
function authFetchFor(lease,{login='newsdayads',ok=true,status=200,bodyOverride}={}) {
  const body=bodyOverride ?? [
    'TIGERIQ_REMOTE_MUTATION_AUTH_V1',
    'OWNER_AUTHORIZED=true',
    'LEASE_ID='+lease.leaseId,
    'TOOL='+lease.tool,
    'ARGS_SHA256='+lease.argsSha256,
    'RISK_CLASS='+lease.riskClass,
    'ISSUED_AT='+lease.issuedAt,
    'EXPIRES_AT='+lease.expiresAt
  ].join('\n');
  return async()=>({ok,status,json:async()=>({user:{login},body})});
}
afterEach(async()=>{ while(tempDirs.length) await rm(tempDirs.pop(),{recursive:true,force:true}); });

describe('Remote Desktop Commander hard runtime guard',()=>{
  it('does not grant a remote mutation bypass based on employee/model identity metadata',async()=>{
    const leasePath=await tempLeasePath();
    for (const principal of ['NV02','NV09','CODEX_LOCAL_PC01','VY']) {
      const result=await enforceRemoteToolCall({
        tool:'start_process',
        args:{command:'echo remote-boundary',timeout_ms:1000,principal},
        leasePath,now:NOW
      });
      expect(result).toEqual({ok:false,reason:'OWNER_AUTH_REQUIRED'});
    }
  });
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

  it('resolves real targets and blocks junction/reparse escape outside observation roots',async()=>{
    const rootMap=new Map(OBSERVATION_DIRECTORIES.map((root)=>[root,root]));
    const allowed='D:\\TigerIQ\\Evidence\\safe.txt';
    const escaped='D:\\TigerIQ\\Evidence\\junction\\secret.txt';
    const realpathImpl=async(value)=>{
      if (rootMap.has(value)) return rootMap.get(value);
      if (value===allowed) return allowed;
      if (value===escaped) return 'D:\\TigerIQ\\Secrets\\secret.txt';
      throw Object.assign(new Error('missing'),{code:'ENOENT'});
    };
    expect(await verifyRealReadScope('read_file',{path:allowed},{realpathImpl}))
      .toEqual({ok:true,reason:'READ_REALPATH_SCOPE_PASS'});
    expect(await verifyRealReadScope('read_file',{path:escaped},{realpathImpl}))
      .toEqual({ok:false,reason:'READ_REPARSE_ESCAPE_DENIED'});
  });

  it('fails closed when a read target realpath cannot be resolved',async()=>{
    const realpathImpl=async(value)=>{
      if (OBSERVATION_DIRECTORIES.includes(value)) return value;
      throw Object.assign(new Error('missing'),{code:'ENOENT'});
    };
    expect(await verifyRealReadScope('read_file',{path:'D:\\TigerIQ\\Evidence\\missing.txt'},{realpathImpl}))
      .toEqual({ok:false,reason:'READ_REALPATH_UNRESOLVED'});
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
      const result=await enforceRemoteToolCall({tool:'start_process',args:{command,timeout_ms:5000},leasePath,now:NOW});
      expect(result).toEqual({ok:false,reason:'OWNER_AUTH_REQUIRED'});
    }
  });

  it('verifies Owner once at lease install, opens exactly one call, then remains closed after replay',async()=>{
    const leasePath=await tempLeasePath();
    const args={path:'D:\\TigerIQ\\Evidence\\guard-canary.txt',content:'ok',mode:'rewrite'};
    const lease=leaseFor('write_file',args);
    let fetchCalls=0;
    const installFetch=async()=>{ fetchCalls+=1; return authFetchFor(lease)(); };
    expect(await installOwnerLeaseFromAuthorization({authorizationUrl:lease.authorizationUrl},{leasePath,now:NOW,fetchImpl:installFetch}))
      .toMatchObject({ok:true,reason:'OWNER_LEASE_INSTALLED',leaseId:'OWNER-TEST-1'});
    expect(fetchCalls).toBe(1);
    expect(await enforceRemoteToolCall({
      tool:'write_file',args,leasePath,now:NOW,
      fetchImpl:async()=>{ throw new Error('mutation must not refetch owner auth'); }
    })).toMatchObject({ok:true,reason:'OWNER_LEASE_VALID_SINGLE_USE',leaseId:'OWNER-TEST-1'});
    expect(fetchCalls).toBe(1);
    await expect(readFile(leasePath,'utf8')).rejects.toMatchObject({code:'ENOENT'});
    const claim=(await readdir(join(leasePath,'..'))).find((name)=>name.startsWith('owner-lease.json.claim-'));
    const receipt=JSON.parse(await readFile(join(join(leasePath,'..'),claim),'utf8'));
    expect(receipt).toMatchObject({consumed:true,decision:'ALLOW_ONCE'});
    expect(await enforceRemoteToolCall({tool:'write_file',args,leasePath,now:NOW}))
      .toEqual({ok:false,reason:'OWNER_AUTH_REQUIRED'});
  });

  it('scope mismatch or expiry consumes the lease fail-closed',async()=>{
    const leasePath=await tempLeasePath();
    const args={command:'echo approved',timeout_ms:1000};
    const mismatchLease=leaseFor('start_process',args);
    await putLease(leasePath,mismatchLease);
    expect(await enforceRemoteToolCall({tool:'start_process',args:{...args,command:'echo changed'},leasePath,now:NOW,fetchImpl:authFetchFor(mismatchLease)}))
      .toMatchObject({ok:false,reason:'LEASE_ARGUMENT_SCOPE_MISMATCH'});
    await expect(readFile(leasePath,'utf8')).rejects.toMatchObject({code:'ENOENT'});

    const expiredLease=leaseFor('start_process',args,{issued:'2026-09-24T23:40:00.000Z',expires:'2026-09-24T23:45:00.000Z'});
    await putLease(leasePath,expiredLease);
    expect(await enforceRemoteToolCall({tool:'start_process',args,leasePath,now:NOW,fetchImpl:authFetchFor(expiredLease)}))
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

  it('rejects forged/mismatched Owner authorization records before lease installation',async()=>{
    const args={path:'D:\\TigerIQ\\Evidence\\forged.txt',content:'x',mode:'rewrite'};
    const lease=leaseFor('write_file',args);
    for (const fetchImpl of [
      authFetchFor(lease,{login:'attacker'}),
      authFetchFor(lease,{bodyOverride:'TIGERIQ_REMOTE_MUTATION_AUTH_V1\nOWNER_AUTHORIZED=true\nLEASE_ID=WRONG'})
    ]) {
      const leasePath=await tempLeasePath();
      const result=await installOwnerLeaseFromAuthorization({authorizationUrl:lease.authorizationUrl},{leasePath,now:NOW,fetchImpl});
      expect(result.ok).toBe(false);
      await expect(readFile(leasePath,'utf8')).rejects.toMatchObject({code:'ENOENT'});
    }
  });

  it('fails closed when Owner authorization verification is unavailable at lease installation',async()=>{
    const leasePath=await tempLeasePath();
    const args={path:'D:\\TigerIQ\\Evidence\\offline.txt',content:'x',mode:'rewrite'};
    const lease=leaseFor('write_file',args);
    const result=await installOwnerLeaseFromAuthorization({authorizationUrl:lease.authorizationUrl},{
      leasePath,now:NOW,fetchImpl:async()=>{ throw new Error('offline'); }
    });
    expect(result).toMatchObject({ok:false,reason:'OWNER_AUTH_VERIFY_FAILED'});
    await expect(readFile(leasePath,'utf8')).rejects.toMatchObject({code:'ENOENT'});
  });

  it('uses the existing local GitHub token to verify Owner authorization in a private repository without exposing it',async()=>{
    const leasePath=await tempLeasePath();
    const args={command:'cmd.exe /c echo private-repo-auth',timeout_ms:1000};
    const lease=leaseFor('start_process',args);
    const secret='test-private-token';
    let seenAuth='';
    const fetchImpl=async(_url,options={})=>{
      seenAuth=String(options?.headers?.Authorization||'');
      return authFetchFor(lease)();
    };
    const result=await installOwnerLeaseFromAuthorization({authorizationUrl:lease.authorizationUrl},{
      leasePath,now:NOW,fetchImpl,tokenPath:'D:\\TigerIQ\\Secrets\\test-token',
      readFileImpl:async()=>secret+'\n'
    });
    expect(result).toMatchObject({ok:true,reason:'OWNER_LEASE_INSTALLED',leaseId:'OWNER-TEST-1'});
    expect(seenAuth).toBe('Bearer '+secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(await readFile(leasePath,'utf8')).not.toContain(secret);
  });

  it('forbids remote security config mutation even when a lease file exists',async()=>{
    const leasePath=await tempLeasePath();
    const args={key:'blockedCommands',value:['x']};
    await putLease(leasePath,leaseFor('set_config_value',args));
    expect(await enforceRemoteToolCall({tool:'set_config_value',args,leasePath,now:NOW}))
      .toEqual({ok:false,reason:'REMOTE_CONFIG_MUTATION_FORBIDDEN'});
    expect(JSON.parse(await readFile(leasePath,'utf8'))).toMatchObject({leaseId:'OWNER-TEST-1'});
  });

  it('unknown tools and shutdown fail closed even when remote metadata is absent',async()=>{
    expect(await enforceRemoteToolCall({tool:'future_mutator',args:{},now:NOW}))
      .toEqual({ok:false,reason:'UNKNOWN_TOOL_FAIL_CLOSED'});
    expect(await enforceRemoteToolCall({tool:'shutdown',args:{},now:NOW}))
      .toEqual({ok:false,reason:'OWNER_AUTH_REQUIRED'});
    expect(await enforceRemoteToolCall({tool:'start_process',args:{command:'echo metadata-bypass'},now:NOW}))
      .toEqual({ok:false,reason:'OWNER_AUTH_REQUIRED'});
  });

  it('patches Desktop Commander dispatcher idempotently and rejects anchor drift',()=>{
    const fixture=[
      "import path from 'path';",
      'async function handleCallToolRequest(request) {',
      '    const { name, arguments: args } = request.params;',
      '    const isRemoteCall = true;',
      '        const filteredTools = allTools.filter(tool => shouldIncludeTool(tool.name));',
      '        setCurrentCallIsRemote(isRemoteCall);',
      '}'
    ].join('\n');
    const once=patchDesktopCommanderServer(fixture);
    const twice=patchDesktopCommanderServer(once);
    expect(twice).toBe(once);
    expect(verifyDesktopCommanderServerPatched(once)).toBe(true);
    expect(once).toContain('if (tigerIqRemoteGuard.terminalResult) return tigerIqRemoteGuard.terminalResult;');
    expect(()=>patchDesktopCommanderServer('unexpected upstream')).toThrow('DESKTOP_COMMANDER_0_2_51_ANCHOR_MISMATCH');
  });


  it('requires explicit risk class for production mutation authorization',()=>{
    const args={command:'vercel deploy --prod',timeout_ms:5000};
    const lease=leaseFor('start_process',args);
    expect(lease.riskClass).toBe('PRODUCTION');
    expect(authorizeRemoteCall({tool:'start_process',args,lease:{...lease,riskClass:'STANDARD'},now:NOW}))
      .toMatchObject({ok:false,reason:'LEASE_RISK_SCOPE_MISMATCH'});
  });

  it('hides mutators from the remote tool surface until a live bounded lease exists',async()=>{
    const leasePath=await tempLeasePath();
    const tools=[{name:'read_file'},{name:'list_processes'},{name:'start_process'},{name:'write_file'},{name:'set_config_value'}];
    const hidden=await filterRemoteToolDefinitions(tools,{leasePath,now:NOW});
    expect(hidden.map((x)=>x.name)).toEqual(['read_file','list_processes',AUTHORIZATION_TOOL]);
    const args={command:'echo bounded',timeout_ms:1000};
    await putLease(leasePath,leaseFor('start_process',args));
    const opened=await filterRemoteToolDefinitions(tools,{leasePath,now:NOW});
    expect(opened.map((x)=>x.name)).toEqual(['read_file','list_processes','start_process',AUTHORIZATION_TOOL]);
  });

  it('installs a lease only through the dedicated Owner authorization tool and never executes the target mutation',async()=>{
    const leasePath=await tempLeasePath();
    const args={path:'D:\\TigerIQ\\Evidence\\authorized.txt',content:'ok',mode:'rewrite'};
    const lease=leaseFor('write_file',args);
    let fetchCalls=0;
    const fetchImpl=async()=>{ fetchCalls+=1; return authFetchFor(lease)(); };
    const installed=await installOwnerLeaseFromAuthorization({authorizationUrl:lease.authorizationUrl},{leasePath,now:NOW,fetchImpl});
    expect(installed).toMatchObject({ok:true,reason:'OWNER_LEASE_INSTALLED',leaseId:'OWNER-TEST-1',tool:'write_file'});
    expect(fetchCalls).toBe(1);
    expect(JSON.parse(await readFile(leasePath,'utf8'))).toEqual(lease);
  });

  it('authorization tool is fail-closed on GitHub 403, forged author, expiry, and existing active lease',async()=>{
    const args={path:'D:\\TigerIQ\\Evidence\\authorized.txt',content:'ok',mode:'rewrite'};
    const lease=leaseFor('write_file',args);

    const p403=await tempLeasePath();
    expect(await installOwnerLeaseFromAuthorization({authorizationUrl:lease.authorizationUrl},{
      leasePath:p403,now:NOW,fetchImpl:async()=>({ok:false,status:403,json:async()=>({})})
    })).toEqual({ok:false,reason:'OWNER_AUTH_VERIFY_HTTP_403'});
    await expect(readFile(p403,'utf8')).rejects.toMatchObject({code:'ENOENT'});

    const forged=await tempLeasePath();
    expect(await installOwnerLeaseFromAuthorization({authorizationUrl:lease.authorizationUrl},{
      leasePath:forged,now:NOW,fetchImpl:authFetchFor(lease,{login:'attacker'})
    })).toEqual({ok:false,reason:'OWNER_AUTH_AUTHOR_MISMATCH'});
    await expect(readFile(forged,'utf8')).rejects.toMatchObject({code:'ENOENT'});

    const expired=await tempLeasePath();
    const oldLease=leaseFor('write_file',args,{issued:'2026-09-24T23:40:00.000Z',expires:'2026-09-24T23:45:00.000Z'});
    expect(await installOwnerLeaseFromAuthorization({authorizationUrl:oldLease.authorizationUrl},{
      leasePath:expired,now:NOW,fetchImpl:authFetchFor(oldLease)
    })).toMatchObject({ok:false,reason:'LEASE_EXPIRED_OR_NOT_ACTIVE'});

    const existing=await tempLeasePath();
    await putLease(existing,lease);
    expect(await installOwnerLeaseFromAuthorization({authorizationUrl:lease.authorizationUrl},{
      leasePath:existing,now:NOW,fetchImpl:authFetchFor(lease)
    })).toEqual({ok:false,reason:'ACTIVE_LEASE_EXISTS'});
  });

  it('rolls over an expired stale lease only after fresh verified Owner authorization',async()=>{
    const leasePath=await tempLeasePath();
    const args={path:'D:\\TigerIQ\\Evidence\\renewed.txt',content:'ok',mode:'rewrite'};
    const fresh=leaseFor('write_file',args);
    const expired={...fresh,leaseId:'OLD-EXPIRED',issuedAt:'2026-09-24T23:40:00.000Z',expiresAt:'2026-09-24T23:45:00.000Z'};
    await putLease(leasePath,expired);
    const installed=await installOwnerLeaseFromAuthorization({authorizationUrl:fresh.authorizationUrl},{
      leasePath,now:NOW,fetchImpl:authFetchFor(fresh)
    });
    expect(installed).toMatchObject({ok:true,reason:'OWNER_LEASE_INSTALLED',leaseId:'OWNER-TEST-1'});
    expect(JSON.parse(await readFile(leasePath,'utf8'))).toEqual(fresh);
    const files=await readdir(join(leasePath,'..'));
    expect(files.some((name)=>name.startsWith('owner-lease.json.stale-'))).toBe(true);
  });

  it('dedicated authorization tool returns terminal success before vendor dispatch',async()=>{
    const leasePath=await tempLeasePath();
    const args={command:'echo scoped',timeout_ms:1000};
    const lease=leaseFor('start_process',args);
    const result=await enforceRemoteToolCall({
      tool:AUTHORIZATION_TOOL,args:{authorizationUrl:lease.authorizationUrl},
      leasePath,now:NOW,fetchImpl:authFetchFor(lease)
    });
    expect(result).toMatchObject({ok:true,reason:'OWNER_LEASE_INSTALLED',terminalResult:{isError:false}});
    expect(result.terminalResult.content[0].text).toBe('TIGERIQ_OWNER_LEASE_INSTALLED:OWNER-TEST-1');
  });

  it('supports bounded Owner authorization through hosted get_prompts catalog compatibility ingress',async()=>{
    const leasePath=await tempLeasePath();
    const targetArgs={command:'cmd.exe /c echo TIGERIQ_RDC_HOSTED_CANARY',timeout_ms:3000};
    const lease=leaseFor('start_process',targetArgs);
    const promptArgs={action:'get_prompt',promptId:'tigeriq_authorize_mutation:'+lease.authorizationUrl};
    const result=await enforceRemoteToolCall({
      tool:'get_prompts',args:promptArgs,leasePath,now:NOW,fetchImpl:authFetchFor(lease)
    });
    expect(result).toMatchObject({ok:true,reason:'OWNER_LEASE_INSTALLED',leaseId:'OWNER-TEST-1',terminalResult:{isError:false}});
    expect(result.terminalResult.content[0].text).toBe('TIGERIQ_OWNER_LEASE_INSTALLED:OWNER-TEST-1');
    expect(JSON.parse(await readFile(leasePath,'utf8'))).toEqual(lease);
    expect(await enforceRemoteToolCall({tool:'get_prompts',args:{action:'get_prompt',promptId:'onb2_01'},leasePath:await tempLeasePath(),now:NOW}))
      .toEqual({ok:false,reason:'OWNER_AUTH_REQUIRED'});
  });

  it('fails closed for malformed hosted authorization compatibility references',async()=>{
    const leasePath=await tempLeasePath();
    const result=await enforceRemoteToolCall({
      tool:'get_prompts',
      args:{action:'get_prompt',promptId:'tigeriq_authorize_mutation:https://example.com/not-owner-auth'},
      leasePath,now:NOW,fetchImpl:async()=>{ throw new Error('must-not-fetch'); }
    });
    expect(result).toEqual({ok:false,reason:'OWNER_AUTH_REF_INVALID'});
    await expect(readFile(leasePath,'utf8')).rejects.toMatchObject({code:'ENOENT'});
  });
  it('patches the launcher with fail-closed guard preflight for restart safety',()=>{
    const launcher='$log="x"\\nSet-Location $app\\nwhile($true){}';
    const patched=patchRemoteLauncher(launcher);
    expect(patched).toMatch(/TIGERIQ_REMOTE_GUARD_LAUNCHER_V3/);
    expect(patched).toMatch(/exit 86/);
    expect(verifyRemoteLauncherPatched(patched)).toBe(true);
    expect(patchRemoteLauncher(patched)).toBe(patched);
  });

  it('keeps the observation allowlist narrow and excludes Secrets',()=>{
    expect(OBSERVATION_DIRECTORIES.length).toBeGreaterThan(0);
    expect(OBSERVATION_DIRECTORIES.some((x)=>/\\Secrets(?:\\|$)/i.test(x))).toBe(false);
  });
});
