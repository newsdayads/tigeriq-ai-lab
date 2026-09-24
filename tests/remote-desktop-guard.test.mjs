import { describe, expect, it } from 'vitest';
import {
  DEFENSE_IN_DEPTH_BLOCKED_COMMANDS, EXPECTED_PERMISSION_MODE, OBSERVATION_DIRECTORIES,
  argsHash, authorizeRemoteCall, consumeOwnerLease, verifyDesktopCommanderConfig
} from '../apps/remote-desktop-guard/policy.mjs';

function leaseFor(tool,args,{issued='2026-09-25T00:00:00.000Z',expires='2026-09-25T00:05:00.000Z'}={}) {
  return {version:1,leaseId:'OWNER-TEST-1',ownerAuthorized:true,tool,argsSha256:argsHash(args),issuedAt:issued,expiresAt:expires,consumed:false};
}
const NOW=Date.parse('2026-09-25T00:01:00.000Z');

describe('Remote Desktop Commander hard mutation guard',()=>{
  it('passes read/list/search/health observation without mutation authorization',()=>{
    for (const tool of ['read_file','list_directory','start_search','list_processes','get_config']) {
      expect(authorizeRemoteCall({tool,now:NOW})).toEqual({ok:true,reason:'READ_ONLY_DEFAULT_PASS'});
    }
  });

  it('fails closed for unauthorized shell/PowerShell/Node/Git/Vercel mutation',()=>{
    for (const command of [
      'powershell.exe -NoProfile -Command "Set-Content x y"',
      'cmd.exe /c del x',
      'node -e "require(\'fs\').writeFileSync(\'x\',\'y\')"',
      'python -c "open(\'x\',\'w\').write(\'y\')"',
      'git push origin main',
      'vercel deploy --prod',
      'vercel remove tigeriq --yes'
    ]) {
      expect(authorizeRemoteCall({tool:'start_process',args:{command,timeout_ms:5000},now:NOW})).toMatchObject({ok:false,reason:'OWNER_AUTH_REQUIRED'});
    }
  });

  it('requires exact tool + exact arguments and bounded expiry',()=>{
    const args={command:'echo bounded-canary',timeout_ms:5000,shell:'cmd.exe'};
    const lease=leaseFor('start_process',args);
    expect(authorizeRemoteCall({tool:'start_process',args,lease,now:NOW})).toMatchObject({ok:true,reason:'OWNER_LEASE_VALID'});
    expect(authorizeRemoteCall({tool:'start_process',args:{...args,command:'echo changed'},lease,now:NOW})).toMatchObject({ok:false,reason:'LEASE_ARGUMENT_SCOPE_MISMATCH'});
    expect(authorizeRemoteCall({tool:'write_file',args,lease,now:NOW})).toMatchObject({ok:false,reason:'LEASE_TOOL_SCOPE_MISMATCH'});
    expect(authorizeRemoteCall({tool:'start_process',args,lease,now:Date.parse('2026-09-25T00:06:00.000Z')})).toMatchObject({ok:false,reason:'LEASE_EXPIRED_OR_NOT_ACTIVE'});
  });

  it('self-closes a single-use lease and remains closed after re-evaluation/restart',()=>{
    const args={path:'D:\\TigerIQ\\Evidence\\guard-canary.txt',content:'ok',mode:'rewrite'};
    const consumed=consumeOwnerLease(leaseFor('write_file',args));
    expect(authorizeRemoteCall({tool:'write_file',args,lease:consumed,now:NOW})).toMatchObject({ok:false,reason:'LEASE_CONSUMED'});
    const serialized=JSON.stringify(consumed);
    const afterRestart=JSON.parse(serialized);
    expect(authorizeRemoteCall({tool:'write_file',args,lease:afterRestart,now:NOW})).toMatchObject({ok:false,reason:'LEASE_CONSUMED'});
  });

  it('fails closed for unknown tools or weakened permission mode',()=>{
    expect(authorizeRemoteCall({tool:'future_mutator',now:NOW})).toMatchObject({ok:false,reason:'UNKNOWN_TOOL_FAIL_CLOSED'});
    const args={command:'echo x',timeout_ms:1000};
    expect(authorizeRemoteCall({tool:'start_process',args,lease:leaseFor('start_process',args),permissionMode:'full_access',now:NOW}))
      .toMatchObject({ok:false,reason:'PERMISSION_MODE_FAIL_CLOSED'});
  });

  it('requires narrow observation directories, deny-shell default, and interpreter blocklist',()=>{
    const config={allowedDirectories:[...OBSERVATION_DIRECTORIES],defaultShell:'__TIGERIQ_REMOTE_SHELL_DENIED__.exe',blockedCommands:[...DEFENSE_IN_DEPTH_BLOCKED_COMMANDS]};
    expect(verifyDesktopCommanderConfig(config)).toEqual({ok:true,errors:[]});
    expect(verifyDesktopCommanderConfig({...config,allowedDirectories:[]})).toMatchObject({ok:false});
    expect(verifyDesktopCommanderConfig({...config,allowedDirectories:['D:\\TigerIQ\\Secrets']})).toMatchObject({ok:false});
  });

  it('pins the platform mutation boundary to ask-before-writes',()=>{
    expect(EXPECTED_PERMISSION_MODE).toBe('ask_before_writes');
  });
});
