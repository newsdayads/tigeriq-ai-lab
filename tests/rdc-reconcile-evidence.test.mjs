import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const updaterUrl=new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url);

describe('RDC reconcile evidence projection',()=>{
  it('publishes sanitized evidence into the Remote Guard observation root on every reconcile path',async()=>{
    const source=await readFile(updaterUrl,'utf8');
    expect(source).toContain("D:\\TigerIQ\\Evidence\\rdc-recovery\\remote-guard-reconcile.json");
    expect(source).toContain("TIGERIQ_RDC_RECONCILE_EVIDENCE_V1");
    expect(source).toContain("Save-RemoteDesktopGuardEvidence $remoteDesktopGuard $local 'NO_CHANGE'");
    expect(source).toContain("Save-RemoteDesktopGuardEvidence $remoteDesktopGuard $remote 'UPDATED'");
    for(const key of ['action','reason','version','authorizer','task','taskState']) {
      expect(source).toContain(key+"=[string]$guard."+key);
    }
    expect(source).toContain("changes=@($guard.changes|ForEach-Object{[string]$_})");
    expect(source).not.toContain("token=[string]$guard");
    expect(source).not.toContain("detail=[string]$guard");
  });
});
