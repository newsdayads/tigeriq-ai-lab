import {it as test,expect} from 'vitest';
import {closedGithubSourceReconciliationPlan,reconcileClosedGithubBlockedObjectives} from '../apps/tigeriq-core/github-intake.mjs';

const SHA='2722a59042485f3d66f5d7fff31ab88166540acc';
const issue=(n=4565)=>({
  number:n,state:'closed',state_reason:'completed',
  closed_at:'2026-10-09T03:00:00Z',
  body:[
    'CURRENT_STATE=CORE_PR4577_MERGED_PC01_DEPLOYED_ACCEPTANCE_VERIFIED',
    'DONE=true',
    'P0_RELEASE_SHA='+SHA,
    'P0_RELEASE_EVIDENCE=issuecomment-6073272017'
  ].join('\n')
});
const row=(n=4565)=>({
  id:'OBJ-GH-'+n,status:'blocked',summary:'AI historical review job exhausted',
  metadata:{source:'github',issueNumber:n,githubResultReported:true}
});
test('P0 owner-completed exact GitHub release reconciles but retains original failure',()=>{
  const plan=closedGithubSourceReconciliationPlan(row(),issue());
  expect(plan.releaseSha).toBe(SHA);
  expect(plan.metadataPatch.previousCoreBlockedSummary).toContain('historical');
  expect(plan.metadataPatch.externalSourceTerminalReconciled).toBe(true);
  expect(plan.metadataPatch.githubClosed).toBe(true);
});
test('separate completed issue with source release SHA and acceptance URL reconciles',()=>{
  const v=issue(4576);
  v.body=['CURRENT_STATE=CORE_SOURCE_RELEASED_PC01_ACCEPTED','DONE=true','SOURCE_RELEASE_SHA='+SHA,
    'CURRENT_ACCEPTANCE_EVIDENCE=https://github.com/newsdayads/tigeriq-ai-lab/issues/4576#issuecomment-6073426892'].join('\n');
  expect(closedGithubSourceReconciliationPlan(row(4576),v)?.sourceIssueNumber).toBe(4576);
});
test('open or non-completed issue cannot reconcile',()=>{
  expect(closedGithubSourceReconciliationPlan(row(),{...issue(),state:'open'})).toBeNull();
  expect(closedGithubSourceReconciliationPlan(row(),{...issue(),state_reason:'not_planned'})).toBeNull();
});
test('no standalone author claim without exact evidence or DONE',()=>{
  const i=issue();
  for(const replacement of [
    i.body.replace('DONE=true','DONE=false'),
    i.body.replace('P0_RELEASE_SHA='+SHA,'P0_RELEASE_SHA=bad'),
    i.body.replace('P0_RELEASE_EVIDENCE=issuecomment-6073272017','P0_RELEASE_EVIDENCE=unknown'),
    i.body.replace('CURRENT_STATE=CORE_PR4577_MERGED_PC01_DEPLOYED_ACCEPTANCE_VERIFIED','CURRENT_STATE=WAITING_REVIEW')
  ]){
    expect(closedGithubSourceReconciliationPlan(row(),{...i,body:replacement})).toBeNull();
  }
});
test('cross-issue evidence, non-source row and already completed row fail closed',()=>{
  expect(closedGithubSourceReconciliationPlan(row(),issue(4576))).toBeNull();
  expect(closedGithubSourceReconciliationPlan({...row(),status:'completed'},issue())).toBeNull();
  expect(closedGithubSourceReconciliationPlan({...row(),metadata:{source:'manual',issueNumber:4565}},issue())).toBeNull();
});
test('database reconciliation is conditional, event-backed and idempotent',async()=>{
  const calls=[];let status='blocked';
  const pool={async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.startsWith('select id,status,summary,metadata'))return {rows:status==='blocked'?[row()]:[]};
    if(sql.startsWith('update tigeriq_objectives')){
      if(status==='blocked'){status='completed';return {rowCount:1,rows:[{id:'OBJ-GH-4565'}]};}
      return {rowCount:0,rows:[]};
    }
    if(sql.startsWith('insert into tigeriq_events'))return {rowCount:1};
    throw new Error('unexpected query '+sql);
  }};
  const first=await reconcileClosedGithubBlockedObjectives({pool,issues:[issue()]});
  expect(first).toEqual({scanned:1,reconciled:1,issueNumbers:[4565]});
  const meta=JSON.parse(calls.find(x=>x.sql.startsWith('update tigeriq_objectives')).args[2]);
  expect(meta.previousCoreBlockedStatus).toBe('blocked');
  expect(calls.filter(x=>x.sql.startsWith('insert into tigeriq_events'))).toHaveLength(1);
  const second=await reconcileClosedGithubBlockedObjectives({pool,issues:[issue()]});
  expect(second.reconciled).toBe(0);
  expect(calls.filter(x=>x.sql.startsWith('insert into tigeriq_events'))).toHaveLength(1);
});
test('does not write when source proof is incomplete',async()=>{
  const pool={async query(sql){
    if(sql.startsWith('select id,status,summary,metadata'))return {rows:[row()]};
    throw new Error('unexpected mutation');
  }};
  const bad={...issue(),body:issue().body.replace('DONE=true','DONE=false')};
  expect((await reconcileClosedGithubBlockedObjectives({pool,issues:[bad]})).reconciled).toBe(0);
});
