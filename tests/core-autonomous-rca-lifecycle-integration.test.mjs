import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
import { withCoreRcaPgLease } from '../apps/tigeriq-core/core-rca-pg-lease.mjs';
import {
  autonomousRcaCanonicalAction, autonomousRcaMaterializationDedupe,
  classifyAutonomousRca, dedupeAutonomousRca, buildImprovementWorkOrder,
  buildOwnerException,
} from '../apps/tigeriq-core/autonomous-rca.mjs';

// Execute production source in a hermetic VM. All GitHub calls are fake and URL-constrained.
const coreSource=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function extract(name,until) {
 const start=coreSource.indexOf('async function '+name+'(');
 const end=coreSource.indexOf(until,start);
 if(start<0||end<=start)throw Error('RCA_SOURCE_BOUNDARY_CHANGED_'+name);
 return coreSource.slice(start,end).trim();
}
const src=[
 extract('githubCreateAutonomousRcaIssue','\nasync function githubAutonomousRcaIssueLifecycle'),
 extract('githubAutonomousRcaIssueLifecycle','\nasync function githubRearmAutonomousRcaIssue'),
 extract('githubRearmAutonomousRcaIssue','\nasync function materializeAutonomousRca'),
 extract('materializeAutonomousRca','\nexport async function runSelfAuditScan'),
].join('\n\n');

function harness({state='open',reason=null,hasPrior=true,priorRearmHash=null,
  ownerHold=false,searchMatches=false,searchUnavailable=false,intentExists=false}={}){
 const anomaly={signature:'test-integrity-anomaly',contract_id:'SERVICE_FUNCTIONAL_INTEGRITY',
  severity:'HIGH',status:'OPEN',count:2,evidence:{component:'SERVICE_FUNCTIONAL_INTEGRITY'}};
 const rca=classifyAutonomousRca({signature:anomaly.signature,contractId:anomaly.contract_id,
  evidence:{...anomaly.evidence,severity:anomaly.severity,observationCount:2}});
 if(!rca.selfFixable||rca.hardGate)throw Error('INVALID_TEST_RCA_FIXTURE');
 const family='RCA_FAMILY_KEY='+rca.rcaFamilyKey;
 let canonical={number:3278,state,state_reason:reason,
  body:priorRearmHash==null
   ?'TIGERIQ_JOB_V1\n'+family
   :['## AUTO-RCA RECURRENCE REARM — AUTHORITATIVE',family,
     'EVIDENCE_HASH='+(priorRearmHash==='CURRENT'?rca.evidenceHash:priorRearmHash),
     'DONE=false','','TIGERIQ_JOB_V1',family].join('\n')};
 if(ownerHold)canonical.body+='\nOWNER_HOLD=true\nPRIORITY=P0\nAUTO_QUEUE=EXCLUDED_OWNER';
 let recordedPrior=hasPrior,created=0,patched=0;
 const emitted=[],requests=[];
 const store={async query(sql,params=[]){
  if(sql.includes('from tigeriq_self_audit_anomalies'))return {rows:[anomaly]};
  if(sql.includes("type='AUTONOMOUS_RCA_CREATE_INTENT'"))return {rows:intentExists?[{present:1}]:[]};
  if(sql.includes('from tigeriq_events')){
   if(params[0]!=='AUTONOMOUS_RCA_WORK_ORDER'||params[1]!==rca.rcaFamilyKey)
    throw Error('RCA_PRIOR_EVENT_QUERY_CONTRACT_CHANGED');
   return {rows:recordedPrior?[{type:'AUTONOMOUS_RCA_WORK_ORDER',
    data:{issueNumber:canonical.number,rcaFamilyKey:rca.rcaFamilyKey}}]:[]};
  }
  throw Error('RCA_UNEXPECTED_QUERY');
 }};
 async function fetchJson(url,opts={}){
  const method=String(opts.method||'GET').toUpperCase();
  requests.push({url,method});
  if(url.startsWith('https://api.github.com/search/issues?q=')){
    if(method!=='GET'||searchUnavailable)throw Error('RCA_SEARCH_UNAVAILABLE');
    return {total_count:searchMatches||created?1:0,incomplete_results:false,
      items:searchMatches||created?[{number:canonical.number}]:[]};
  }
  if(url==='https://api.github.com/repos/hermetic/sandbox/issues'){
    if(method!=='POST')throw Error('UNEXPECTED_CREATE_METHOD');
    created++;
    const payload=JSON.parse(opts.body);
    if(typeof payload.body!=='string'||!payload.body.includes(family))throw Error('CREATED_MISSING_FAMILY_KEY');
    canonical={number:4001,state:'open',state_reason:null,body:payload.body};
    return {...canonical,html_url:'https://github.com/hermetic/sandbox/issues/4001'};
  }
  if(url==='https://api.github.com/repos/hermetic/sandbox/issues/'+canonical.number){
    if(method==='GET')return {...canonical};
    if(method==='PATCH'){
      patched++;
      const payload=JSON.parse(opts.body);
      if(payload.state!=='open'||typeof payload.body!=='string')throw Error('UNSAFE_PATCH');
      canonical={...canonical,state:'open',state_reason:'reopened',body:payload.body};
      return {...canonical};
    }
  }
  throw Error('RCA_NETWORK_ESCAPED_SANDBOX_'+method);
 }
 const sandbox={
  GITHUB_TOKEN:'FAKE_NEVER_EXTERNAL',GITHUB_OWNER:'hermetic',GITHUB_REPO:'sandbox',
  fetchJson,event:async(type,payload)=>{
   emitted.push({type,payload});
   if(type==='AUTONOMOUS_RCA_CREATE_INTENT')intentExists=true;
   if(type==='AUTONOMOUS_RCA_WORK_ORDER'&&Number(payload.issueNumber)>0)recordedPrior=true;
  },
  classifyAutonomousRca,dedupeAutonomousRca,autonomousRcaCanonicalAction,
  autonomousRcaMaterializationDedupe,buildImprovementWorkOrder,buildOwnerException,
 };
 const fn=runInNewContext(src+'\nmaterializeAutonomousRca;',sandbox,{timeout:2000});
 return {run:()=>fn({store}),emitted,requests,rca,
   get issue(){return canonical;},get created(){return created;},get patched(){return patched;}};
}

describe('Issue #3278 — actual Core Auto-RCA lifecycle source / safe replay',()=>{
 for(const [state,reason,action] of [
   ['open',null,'DEDUPE_ACTIVE'],['reopened',null,'DEDUPE_ACTIVE'],
   ['closed','not_planned','SUPPRESS_CLOSED'],['closed','duplicate','SUPPRESS_CLOSED'],
   ['unknown',null,'DEDUPE_UNKNOWN'],
 ]){
  it('never duplicates '+state+'/'+reason,async()=>{
   const h=harness({state,reason}),r=await h.run();
   expect(r).toMatchObject({candidates:1,workOrders:0,deduped:1,blocked:0});
   expect(h.created).toBe(0);expect(h.patched).toBe(0);
   expect(h.emitted[0].payload.canonicalAction).toBe(action);
  });
 }
 it('rearms closed-completed once, then dedupes open recurrence',async()=>{
  const h=harness({state:'closed',reason:'completed'});
  const first=await h.run();
  expect(first).toMatchObject({workOrders:0,deduped:1,blocked:0});
  expect(h.patched).toBe(1);expect(h.created).toBe(0);
  expect(h.issue.body).toContain('TIGERIQ_EXECUTABLE=true');
  await h.run();expect(h.patched).toBe(1);expect(h.created).toBe(0);
 });
 it('refreshes only the current EVIDENCE_HASH, retains historical header',async()=>{
  const h=harness({state:'closed',reason:'completed',priorRearmHash:'OLDHASH'});
  await h.run();
  expect(h.issue.body.split('\n\n')[0]).toContain('EVIDENCE_HASH='+h.rca.evidenceHash);
  expect(h.issue.body).toContain('EVIDENCE_HASH=OLDHASH');
  expect(h.created).toBe(0);expect(h.patched).toBe(1);
 });
 it('keeps same-hash header idempotent',async()=>{
  const h=harness({state:'closed',reason:'completed',priorRearmHash:'CURRENT'});
  await h.run();expect(h.patched).toBe(1);
  expect(h.issue.body.match(/## AUTO-RCA RECURRENCE REARM/g)).toHaveLength(1);
 });
 it('denies owner HOLD, P0 and excluded body even with fresh EVIDENCE_HASH',async()=>{
  const h=harness({state:'closed',reason:'completed',ownerHold:true,priorRearmHash:'OLD'});
  const r=await h.run();
  expect(r).toMatchObject({blocked:1,workOrders:0});
  expect(h.patched).toBe(0);expect(h.created).toBe(0);
  expect(h.issue.body).not.toContain('TIGERIQ_EXECUTABLE=true');
  expect(h.emitted.some(e=>e.payload.reason==='RCA_CANONICAL_OWNER_GATE')).toBe(true);
 });
 it('recovers canonical family when DB history is missing, without duplicate issue',async()=>{
  const h=harness({hasPrior:false,searchMatches:true,state:'open'});
  const r=await h.run();
  expect(r).toMatchObject({workOrders:0,deduped:1,blocked:0});
  expect(h.created).toBe(0);
  expect(h.emitted.some(e=>e.type==='AUTONOMOUS_RCA_WORK_ORDER'&&
    e.payload.source==='CANONICAL_RECOVERED_FROM_GITHUB')).toBe(true);
 });
 it('permits a true first-ever family exactly once with durable pre-POST intent',async()=>{
  const h=harness({hasPrior:false});
  const r=await h.run();
  expect(r).toMatchObject({candidates:1,workOrders:1,blocked:0});
  expect(h.created).toBe(1);expect(h.emitted[0].type).toBe('AUTONOMOUS_RCA_CREATE_INTENT');
  expect(h.emitted[1].type).toBe('AUTONOMOUS_RCA_WORK_ORDER');
  await h.run();expect(h.created).toBe(1);
 });
 it('fails closed when lost-history intent exists and search found no indexed issue',async()=>{
  const h=harness({hasPrior:false,intentExists:true});
  const r=await h.run();
  expect(r).toMatchObject({candidates:1,workOrders:0,blocked:1});
  expect(h.created).toBe(0);
  expect(h.emitted.some(e=>e.payload.reason==='RCA_CANONICAL_CREATE_INTENT_UNRESOLVED')).toBe(true);
 });
 it('fails closed if canonical GitHub search cannot be verified',async()=>{
  const h=harness({hasPrior:false,searchUnavailable:true});
  const r=await h.run();
  expect(r).toMatchObject({candidates:1,workOrders:0,blocked:1});
  expect(h.created).toBe(0);
 });
});

describe('Auto-RCA PostgreSQL session lease / one materializer at a time',()=>{
 const pool=(acquired=true)=>{let releases=[];
  return {releases,connect:async()=>({query:async(sql)=>{
   if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired}]};
   if(sql.includes('pg_advisory_unlock'))return {rows:[{unlocked:true}]};
   throw Error('UNKNOWN_SQL');
  },release:(forced)=>releases.push(forced===true)})};
 };
 it('admits owner and releases lock on success',async()=>{
  const p=pool(),res=await withCoreRcaPgLease(p,async()=>42);
  expect(res).toEqual({admitted:true,outcome:42});expect(p.releases).toEqual([false]);
 });
 it('denies simultaneous owner without invoking RCA',async()=>{
  const p=pool(false);let ran=false;
  const res=await withCoreRcaPgLease(p,async()=>{ran=true;});
  expect(res).toEqual({admitted:false});expect(ran).toBe(false);
 });
 it('unlocks even if RCA network operation fails',async()=>{
  const p=pool();
  await expect(withCoreRcaPgLease(p,async()=>{throw Error('NETWORK');})).rejects.toThrow('NETWORK');
  expect(p.releases).toEqual([false]);
 });
});
