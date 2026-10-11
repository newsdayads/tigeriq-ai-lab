import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { evaluateSelfAudit } from '../apps/tigeriq-core/self-audit.mjs';

const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function collectSelfAuditSnapshot(store=pool){');
if(start<0)throw new Error('COLLECT_SELF_AUDIT_SNAPSHOT_SOURCE_MISSING');
const end=source.indexOf('\n}\n',start);
if(end<0)throw new Error('COLLECT_SELF_AUDIT_SNAPSHOT_END_MISSING');
const productionFunction=source.slice(start,end+2).replace('async function collectSelfAuditSnapshot(store=pool)', 'async function collectSelfAuditSnapshot(store)');

async function snapshot({updater=null,watchdog=null}={}){
  const fixtures={UPDATER:updater,RUNTIME:{},WATCHDOG:watchdog};
  const context={
    process:{env:{}},CORE_RUNTIME_UPDATER_STATE:'UPDATER',CORE_RUNTIME_SOURCE_STATE:'RUNTIME',
    BOOTSTRAP_WATCHDOG_STATE:'WATCHDOG',
    readSelfAuditJsonState:path=>fixtures[path]??null,
    selfAuditStateFresh:(s,now)=>{
      const ts=Date.parse(String(s?.updatedAt||s?.updated_at||''));
      return Number.isFinite(ts)&&now>=ts&&now-ts<=600_000;
    },
    routingFunctionalEvidence:async()=>({}),
    resolveRuntimeSourceIdentity:()=>({expectedSha:'a',installedSha:'a',gateSha:'a',canonicalSourceSha:'a'}),
    selfAuditFunctionalFailureKeys:()=>[],
  };
  const collect=runInNewContext('('+productionFunction+')',context);
  const store={query:async()=>({rows:[]})};
  return collect(store);
}
const recent=(ageMs=15_000)=>new Date(Date.now()-ageMs).toISOString();
const healthyUpdater=()=>({updatedAt:recent(),result:'NO_CHANGE',secret:'not-to-publish'});
const healthyWatchdog=()=>({
  updatedAt:recent(),services:[{key:'updater',healthy:true,taskRunning:true,
    heartbeatFresh:true,heartbeatAgeSec:26,privateToken:'not-to-publish'}],
});

describe('Issue #2788 - real snapshot-to-anomaly integration',()=>{
  it('reads distinct updater-state and watchdog-task ages from their actual sources',async()=>{
    const actual=await snapshot({updater:healthyUpdater(),watchdog:healthyWatchdog()});
    expect(actual.watchdog.updaterHealthy).toBe(true);
    expect(actual.watchdog.watchdogHealthy).toBe(true);
    expect(actual.watchdog.healthDetails).toMatchObject({
      updaterStatePresent:true,updaterStateFresh:true,watchdogStatePresent:true,
      watchdogStateFresh:true,watchdogUpdaterRowPresent:true,watchdogUpdaterRowHealthy:true,
      updaterTaskRunning:true,updaterHeartbeatFresh:true,updaterResultFailed:false,
      updaterTaskHeartbeatAgeSec:26,
    });
    expect(actual.watchdog.healthDetails.updaterStateAgeSec).toBeGreaterThanOrEqual(14);
    expect(actual.watchdog.healthDetails.updaterStateAgeSec).toBeLessThan(60);
    expect(evaluateSelfAudit(actual).anomalies.filter(a=>a.contractId==='UPDATER_WATCHDOG_HEALTH')).toEqual([]);
  });
  it('publishes stale updater state despite a healthy Watchdog row without leaking raw state',async()=>{
    const actual=await snapshot({
      updater:{updatedAt:recent(3_600_000),result:'NO_CHANGE',secret:'not-to-publish'},
      watchdog:healthyWatchdog(),
    });
    expect(actual.watchdog.updaterHealthy).toBe(false);
    expect(actual.watchdog.watchdogHealthy).toBe(true);
    const a=evaluateSelfAudit(actual).anomalies.find(a=>a.contractId==='UPDATER_WATCHDOG_HEALTH');
    expect(a?.evidence).toMatchObject({
      updaterHealthy:false,watchdogHealthy:true,updaterStateFresh:false,
      watchdogUpdaterRowHealthy:true,updaterTaskRunning:true,updaterHeartbeatFresh:true,
      updaterResultFailed:false,updaterTaskHeartbeatAgeSec:26,
    });
    expect(a?.evidence?.updaterStateAgeSec).toBeGreaterThanOrEqual(3500);
    expect(JSON.stringify(a)).not.toContain('not-to-publish');
  });
  it('isolates failed updater result from otherwise fresh state and healthy task',async()=>{
    const actual=await snapshot({
      updater:{updatedAt:recent(),result:'FAILED'},watchdog:healthyWatchdog(),
    });
    expect(actual.watchdog.updaterHealthy).toBe(false);
    const a=evaluateSelfAudit(actual).anomalies.find(a=>a.contractId==='UPDATER_WATCHDOG_HEALTH');
    expect(a?.evidence?.updaterResultFailed).toBe(true);
    expect(a?.evidence?.watchdogUpdaterRowHealthy).toBe(true);
  });
  it('distinguishes missing updater row from absent watchdog state',async()=>{
    const actual=await snapshot({
      updater:{updatedAt:recent(3_600_000),result:'NO_CHANGE'},
      watchdog:{updatedAt:recent(),services:[{key:'core',healthy:true}]},
    });
    const a=evaluateSelfAudit(actual).anomalies.find(a=>a.contractId==='UPDATER_WATCHDOG_HEALTH');
    expect(a?.evidence).toMatchObject({
      updaterHealthy:false,watchdogHealthy:true,watchdogStatePresent:true,
      watchdogUpdaterRowPresent:false,updaterStateFresh:false,
    });
    expect(a?.evidence).not.toHaveProperty('updaterTaskRunning');
    expect(a?.evidence).not.toHaveProperty('updaterTaskHeartbeatAgeSec');
  });
});
