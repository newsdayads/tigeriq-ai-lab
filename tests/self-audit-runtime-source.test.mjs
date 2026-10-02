import {describe,expect,it} from 'vitest';
import {evaluateSelfAudit,resolveRuntimeSourceIdentity,selfAuditFunctionalFailureKeys} from '../apps/tigeriq-core/self-audit.mjs';

describe('#2850 runtime source identity',()=>{
  it('does not treat a squash-merge gate head as the canonical installed SHA',()=>{
    const identity=resolveRuntimeSourceIdentity({
      runtimeSourceState:{
        currentSha:'merge-sha',
        gateSha:'pr-head-sha',
      },
      updaterState:{
        installedSha:'merge-sha',
        gateSha:'pr-head-sha',
      },
    });
    expect(identity).toEqual({
      expectedSha:'merge-sha',
      installedSha:'merge-sha',
      gateSha:'pr-head-sha',
      canonicalSourceSha:'merge-sha',
    });
    const audit=evaluateSelfAudit({
      runtime:identity,
      service:{healthy:true,functionalFailures:[]},
    });
    expect(audit.anomalies.some(x=>x.contractId==='RUNTIME_SOURCE_SHA')).toBe(false);
  });

  it('still detects a true runtime/source mismatch after deployment lag or rollback',()=>{
    const identity=resolveRuntimeSourceIdentity({
      runtimeSourceState:{currentSha:'main-merge-sha',gateSha:'pr-head-sha'},
      updaterState:{installedSha:'old-runtime-sha',gateSha:'pr-head-sha'},
    });
    const audit=evaluateSelfAudit({runtime:identity});
    expect(audit.anomalies).toContainEqual(expect.objectContaining({
      contractId:'RUNTIME_SOURCE_SHA',
      evidence:{expectedSha:'main-merge-sha',installedSha:'old-runtime-sha'},
    }));
  });

  it('keeps explicit canary/source overrides authoritative when supplied',()=>{
    const identity=resolveRuntimeSourceIdentity({
      explicitExpectedSha:'explicit-expected',
      explicitInstalledSha:'explicit-installed',
      runtimeSourceState:{currentSha:'merge-sha',gateSha:'pr-head-sha'},
      updaterState:{installedSha:'merge-sha'},
    });
    expect(identity.expectedSha).toBe('explicit-expected');
    expect(identity.installedSha).toBe('explicit-installed');
  });

  it('uses runtime source state as installed identity while updater state is still catching up',()=>{
    const identity=resolveRuntimeSourceIdentity({
      runtimeSourceState:{currentSha:'new-merge-sha',gateSha:'new-merge-sha'},
      updaterState:{installedSha:'old-merge-sha',gateSha:'old-gate-sha'},
    });
    expect(identity.expectedSha).toBe('new-merge-sha');
    expect(identity.installedSha).toBe('new-merge-sha');
    expect(evaluateSelfAudit({runtime:identity}).anomalies.some(x=>x.contractId==='RUNTIME_SOURCE_SHA')).toBe(false);
  });

  it('drops persisted runtime mismatch from service integrity once live runtime source is aligned',()=>{
    const rows=[
      {contract_id:'RUNTIME_SOURCE_SHA',signature:'stale-runtime'},
      {contract_id:'UPDATER_WATCHDOG_HEALTH',signature:'real-watchdog'},
    ];
    expect(selfAuditFunctionalFailureKeys(rows,{runtimeSourceAligned:true})).toEqual([
      'UPDATER_WATCHDOG_HEALTH:real-watchdog',
    ]);
    expect(selfAuditFunctionalFailureKeys(rows,{runtimeSourceAligned:false})).toEqual([
      'RUNTIME_SOURCE_SHA:stale-runtime',
      'UPDATER_WATCHDOG_HEALTH:real-watchdog',
    ]);
  });
});
