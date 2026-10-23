import {describe,it,expect} from 'vitest';
import {assessMainCiGate,REQUIRED_MAIN_CI_WORKFLOWS} from '../apps/tigeriq-core/main-ci-health.mjs';
import {evaluateSelfAudit} from '../apps/tigeriq-core/self-audit.mjs';
import {classifyAutonomousRca,buildImprovementWorkOrder} from '../apps/tigeriq-core/autonomous-rca.mjs';
import {readFileSync} from 'node:fs';

const sha='a'.repeat(40),other='b'.repeat(40),now=Date.parse('2026-10-23T02:00:00Z');
const run=(name,id,conclusion='success',opts={})=>({
 id,name,event:'push',head_branch:'main',head_sha:sha,
 status:'completed',conclusion,...opts
});
const check=(runs,seconds=120)=>assessMainCiGate({
 mainSha:sha,commitAt:new Date(now-seconds*1000).toISOString(),workflowRuns:runs,nowMs:now
});
describe('GH-5144 main CI -> existing self-audit -> RCA coding lane',()=>{
 it('accepts success only from exact main push SHA; newer green beats older red',()=>{
  const rows=REQUIRED_MAIN_CI_WORKFLOWS.map((n,i)=>run(n,i+11));
  expect(check(rows).state).toBe('PASS');
  expect(check([...rows,run('CI',91,'failure',{head_sha:other})]).state).toBe('PASS');
  expect(check([...rows,run('CI',92,'failure',{event:'pull_request'})]).state).toBe('PASS');
  expect(check([...rows,run('CI',93,'failure'),run('CI',94)]).state).toBe('PASS');
 });
 it('distinguishes actionable red CI from pending/missing and never invents immediate failure',()=>{
  const rows=REQUIRED_MAIN_CI_WORKFLOWS.map((n,i)=>run(n,i+1));
  expect(check([...rows,run('CI',80,'failure')]).state).toBe('FAILED');
  expect(check(rows.filter(x=>x.name!=='CI')).state).toBe('WAITING');
  expect(check(rows.filter(x=>x.name!=='CI'),3600).state).toBe('STALLED');
  expect(check([...rows,run('CI',90,null,{status:'in_progress'})]).state).toBe('WAITING');
  expect(check([],3600).affected).toEqual(REQUIRED_MAIN_CI_WORKFLOWS);
 });
 it('fails closed on unverified source, spoofed SHA and invalid age',()=>{
  expect(assessMainCiGate({mainSha:'INVALID',commitAt:new Date(now).toISOString(),workflowRuns:[],nowMs:now}).state).toBe('UNKNOWN');
  expect(assessMainCiGate({mainSha:sha,workflowRuns:[],nowMs:now}).state).toBe('UNKNOWN');
  expect(check([run('CI',99,'failure',{head_sha:other})]).state).toBe('WAITING');
 });
 it('dedupes one CI repair RCA family across main SHA changes without bypassing release gates',()=>{
  const checkA=check(REQUIRED_MAIN_CI_WORKFLOWS.map((n,i)=>run(n,i+1)).concat(run('CI',99,'failure')));
  const checkB={...checkA,mainSha:other};
  const make=ci=>evaluateSelfAudit({mainCi:ci}).anomalies.find(a=>a.contractId==='MAIN_CI_GATE_HEALTH');
  const a=make(checkA),b=make(checkB);
  expect(a.evidence.sourceSha).toBe(sha);
  expect(a.signature).toBe(b.signature);
  const rca=classifyAutonomousRca(a);
  expect(rca.class).toBe('SOURCE_CODE');
  expect(rca.selfFixable).toBe(true);
  const child=buildImprovementWorkOrder(rca);
  expect(child.body).toContain('CAPABILITY=coding');
  expect(child.body).toContain('EXECUTION_SURFACE=CODING');
  expect(child.body).toContain('NO_PRODUCTION_RELEASE=true');
  expect(child.body).toContain('AUTO_QUEUE=INCLUDED');
  expect(make({state:'PASS',mainSha:sha,runs:[] })).toBeUndefined();
  expect(make({state:'WAITING',mainSha:sha,runs:[] })).toBeUndefined();
 });
 it('wires active Core audit, not a new watcher, to the authenticated GitHub main checks',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  expect(core).toContain('async function probeMainCiGate()');
  expect(core).toContain('snapshot.mainCi=await probeMainCiGate()');
  expect(core).toContain("await materializeAutonomousRca({store})");
  expect(core).toContain('runPendingContinuousVerify()');
 });
});
