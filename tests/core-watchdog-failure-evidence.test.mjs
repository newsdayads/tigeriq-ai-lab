import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { evaluateSelfAudit } from '../apps/tigeriq-core/self-audit.mjs';

const watchdogAnomalies=snapshot=>evaluateSelfAudit({watchdog:snapshot}).anomalies
  .filter(item=>item.contractId==='UPDATER_WATCHDOG_HEALTH');

describe('Issue #2788 - watchdog root-cause evidence',()=>{
  it('preserves the existing signature and records only bounded sub-signals when updater is unhealthy',()=>{
    const anomalies=watchdogAnomalies({
      updaterHealthy:false,watchdogHealthy:true,
      healthDetails:{
        updaterStatePresent:true,updaterStateFresh:false,
        watchdogStatePresent:true,watchdogStateFresh:true,
        watchdogUpdaterRowPresent:true,watchdogUpdaterRowHealthy:true,
        updaterResultFailed:false,updaterHeartbeatAgeSec:401,
        token:'must-not-publish',remoteDesktopGuard:'internal-secret',
      },
    });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].signature).toBe('306269a14fcaa839fd51');
    expect(anomalies[0].evidence).toEqual({
      updaterHealthy:false,watchdogHealthy:true,
      updaterStatePresent:true,updaterStateFresh:false,
      watchdogStatePresent:true,watchdogStateFresh:true,
      watchdogUpdaterRowPresent:true,watchdogUpdaterRowHealthy:true,
      updaterResultFailed:false,updaterHeartbeatAgeSec:401,
    });
    expect(JSON.stringify(anomalies)).not.toContain('must-not-publish');
    expect(JSON.stringify(anomalies)).not.toContain('internal-secret');
  });

  it('keeps legacy evidence compatible and rejects malformed or excess diagnostic values',()=>{
    expect(watchdogAnomalies({updaterHealthy:false,watchdogHealthy:true})[0].evidence)
      .toEqual({updaterHealthy:false,watchdogHealthy:true});
    const evidence=watchdogAnomalies({updaterHealthy:true,watchdogHealthy:false,healthDetails:{
      updaterStateFresh:'false',updaterHeartbeatAgeSec:-45,
      watchdogStateFresh:false,updaterResultFailed:true,
      other:'ignore-me',
    }})[0].evidence;
    expect(evidence).toEqual({
      updaterHealthy:true,watchdogHealthy:false,
      watchdogStateFresh:false,updaterResultFailed:true,
    });
    expect(watchdogAnomalies({updaterHealthy:false,watchdogHealthy:true,healthDetails:{
      updaterHeartbeatAgeSec:999999999,
    }})[0].evidence.updaterHeartbeatAgeSec).toBe(2592000);
  });

  it('creates no anomaly for healthy or unknown watchdog status',()=>{
    expect(watchdogAnomalies({updaterHealthy:true,watchdogHealthy:true,
      healthDetails:{updaterStateFresh:true}})).toEqual([]);
    expect(watchdogAnomalies({})).toEqual([]);
  });

  it('wires safe reason diagnostics from Core state without publishing original updater state',()=>{
    const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(source).toContain('watchdogHealthDetails={');
    expect(source).toContain('updaterStateFresh:updaterState?updaterFresh:null');
    expect(source).toContain('watchdogUpdaterRowHealthy:updaterService?updaterService.healthy===true:null');
    expect(source).toContain('updaterResultFailed:updaterFailed');
    expect(source).toContain('healthDetails:watchdogHealthDetails');
    expect(source).not.toContain('watchdogHealthDetails:updaterState');
  });
});
