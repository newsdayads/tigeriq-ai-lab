import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const updaterUrl=new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url);

describe('RDC reconcile evidence projection',()=>{
  it('publishes sanitized evidence into the Remote Guard observation root on every reconcile path',async()=>{
    const source=await readFile(updaterUrl,'utf8');
    expect(source).toContain("remote-guard-reconcile.json");
    expect(source).toContain("TIGERIQ_RDC_RECONCILE_EVIDENCE_V1");
    expect(source).toContain("Save-RemoteDesktopGuardEvidence $remoteDesktopGuard $local 'NO_CHANGE'");
    expect(source).toContain("Save-RemoteDesktopGuardEvidence $remoteDesktopGuard $remote 'UPDATED'");
    for(const key of ['action','reason','version','authorizer','task','taskState','changes']) {
      expect(source).toContain(key+"=[string]$guard."+key);
    }
    expect(source).not.toContain("token=[string]$guard");
    expect(source).not.toContain("detail=[string]$guard");
  });
});
