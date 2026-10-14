import {describe,it,expect} from 'vitest';
import {
  compileChildDag,taskScopesOverlap,taskWriteConflict,childAcceptanceDecision,
  planReadyChildBatch,parentFinishDecision,
} from '../apps/shared/work-order-dag.mjs';

const REV='rev-v1',SHA='a'.repeat(40),MERGE='b'.repeat(40);
const resource=(id,caps=['coding'])=>({resource_id:'res:'+id,eligible:true,busy:false,capabilities:caps});
const task=(id,extra={})=>({
  task_id:id,source_revision:REV,priority:1,status:'ready',capability:'coding',
  depends_on:[],write_paths:['projects/'+id+'/source.mjs'],exclusive_scope:'project-'+id,required:true,...extra,
});
const evidence=task0=>({
  accepted:true,task_id:task0.task_id,source_revision:task0.source_revision,evidence_refs:['https://github.com/org/repo/pull/1'],
  coding:{head_sha:SHA,ci_passed:true,ci_head_sha:SHA,merge_sha:MERGE,pr_url:'https://github.com/org/repo/pull/1',
    review:{approved:true,reviewer_id:'NV03',author_id:'NV09',head_sha:SHA}},
});
const accepted=t=>({...t,status:'accepted',receipt:evidence(t)});
const graph=(nodes)=>compileChildDag(nodes,{sourceRevision:REV});

describe('GH-280 S4 child DAG + concurrency admission pure contract',()=>{
  it('checks dependency order and refuses cycles, duplicates, missing deps and stale revisions',()=>{
    const a=task('a'),b=task('b',{depends_on:['a']});
    expect(graph([b,a]).topologicalOrder).toEqual(['a','b']);
    expect(()=>graph([task('x',{depends_on:['y']}),task('y',{depends_on:['x']})])).toThrow('DAG_DEPENDENCY_CYCLE');
    expect(()=>graph([task('a'),task('a')])).toThrow('DAG_DUPLICATE_TASK');
    expect(()=>graph([task('a',{depends_on:['absent']})])).toThrow('DAG_MISSING_DEPENDENCY');
    expect(()=>graph([task('a',{source_revision:'rev-stale'})])).toThrow('DAG_STALE_SOURCE_REVISION');
  });

  it('rejects unsafe paths, ambiguous scopes, invalid statuses and unsupported capabilities',()=>{
    for(const bad of ['../evil.mjs','/abs/path','a//b','folder/../secret','./local','a\\b','bad/']){
      expect(()=>graph([task('a',{write_paths:[bad]})])).toThrow('DAG_UNSAFE_PATH');
    }
    expect(()=>graph([task('a',{write_paths:[],exclusive_scope:''})])).toThrow('DAG_SCOPE_REQUIRED');
    expect(()=>graph([task('a',{status:'done'})])).toThrow('DAG_STATUS_INVALID');
    expect(()=>graph([task('a',{priority:0})])).toThrow('DAG_PRIORITY_INVALID');
    expect(()=>graph([])).toThrow('DAG_CHILD_COUNT_INVALID');
  });

  it('returns three independent proposals with distinct workers but performs no claims',()=>{
    const g=graph([task('a'),task('b'),task('c')]);
    const batch=planReadyChildBatch(g,{resources:[resource('NV09'),resource('NV19'),resource('NV20')],limit:6});
    expect(batch.map(x=>x.task_id)).toEqual(['a','b','c']);
    expect(new Set(batch.map(x=>x.resource_id)).size).toBe(3);
    expect(batch.every(x=>x.claim_state==='PROPOSED_NOT_CLAIMED')).toBe(true);
    expect(g.tasks.every(x=>x.status==='ready')).toBe(true);
  });

  it('serializes overlapping file paths even when the resource IDs differ',()=>{
    expect(taskScopesOverlap('tests','tests/a.test.mjs')).toBe(true);
    expect(taskScopesOverlap('tests/a.test.mjs','tests/ab.test.mjs')).toBe(false);
    expect(taskWriteConflict({write_paths:['tests/a.test.mjs']},{write_paths:['tests']})).toBe(true);
    const g=graph([
      task('a',{write_paths:['tests/a.test.mjs'],exclusive_scope:'scope-a'}),
      task('b',{write_paths:['tests'],exclusive_scope:'scope-b'}),
    ]);
    const candidates=planReadyChildBatch(g,{resources:[resource('NV09'),resource('NV20')]});
    expect(candidates).toHaveLength(1);
  });

  it('holds one writer per exclusive scope and per resource ID, including active external work',()=>{
    const g=graph([
      task('a',{exclusive_scope:'same-device',write_paths:[]}),
      task('b',{exclusive_scope:'same-device',write_paths:[]}),
    ]);
    expect(planReadyChildBatch(g,{resources:[resource('NV09'),resource('NV20')]})).toHaveLength(1);
    expect(planReadyChildBatch(graph([task('a'),task('b')]),{resources:[resource('NV09')]})).toHaveLength(1);
    const external=[{resource_id:'res:NV20',write_paths:['projects/a'],exclusive_scope:'unrelated'}];
    const out=planReadyChildBatch(graph([task('a')]),{resources:[resource('NV09'),resource('NV20')],occupied:external});
    expect(out).toHaveLength(0);
    expect(()=>planReadyChildBatch(g,{resources:[resource('NV09')],occupied:[{resource_id:'res:NV20'}]})).toThrow('DAG_OCCUPIED_SCOPE_MISSING');
  });

  it('fail-closes rate limits, resource unavailability and explicit Owner gates',()=>{
    const g=graph([
      task('a',{owner_gate_required:true,owner_gate_accepted:false}),
      task('b'),
      task('c',{capability:'mobile',priority:2}),
    ]);
    const result=planReadyChildBatch(g,{resources:[
      resource('NV09',['coding']),{...resource('NV19'),eligible:false},resource('NV102',['mobile']),
    ]});
    expect(result.map(x=>x.task_id)).toEqual(['b','c']);
    expect(planReadyChildBatch(graph([task('b')]),{resources:[{...resource('NV09'),busy:true}]})).toHaveLength(0);
  });

  it('does not schedule a dependent child from an unverified DONE checkbox',()=>{
    const first=task('first',{status:'accepted',receipt:{accepted:true,task_id:'first',source_revision:REV,evidence_refs:[]}});
    const second=task('second',{depends_on:['first']});
    expect(planReadyChildBatch(graph([first,second]),{resources:[resource('NV09')]})).toHaveLength(0);
    const verified=accepted(task('first'));
    expect(planReadyChildBatch(graph([verified,second]),{resources:[resource('NV09')]}).map(x=>x.task_id)).toEqual(['second']);
  });

  it('rejects false coding acceptance: exact CI head, reviewer identity and merge must be proven',()=>{
    const base=accepted(task('a'));
    expect(childAcceptanceDecision(base).pass).toBe(true);
    const invalid=(f)=>({...base,receipt:{...base.receipt,coding:f({...base.receipt.coding})}});
    expect(childAcceptanceDecision(invalid(c=>({...c,ci_head_sha:MERGE}))).reason).toBe('CODING_MERGE_CI_UNPROVEN');
    expect(childAcceptanceDecision(invalid(c=>({...c,merge_sha:null}))).pass).toBe(false);
    expect(childAcceptanceDecision(invalid(c=>({...c,review:{...c.review,reviewer_id:'NV09'}}))).reason)
      .toBe('CODING_INDEPENDENT_REVIEW_MISSING');
    expect(childAcceptanceDecision(invalid(c=>({...c,review:{...c.review,head_sha:MERGE}}))).pass).toBe(false);
    const waiverReview={approved:false,owner_waiver_allowed:true,owner_waived:true,waiver_url:'https://github.com/org/repo/issues/1'};
    expect(childAcceptanceDecision(invalid(c=>({...c,review:waiverReview}))).pass).toBe(true);
    expect(childAcceptanceDecision(invalid(c=>({...c,review:{...waiverReview,owner_waiver_allowed:false}}))).pass).toBe(false);
  });

  it('never marks the Parent DONE after only one merged PR, and checks Owner/active lease',()=>{
    const a=accepted(task('a'));
    const b=task('b');
    const first=parentFinishDecision(graph([a,b]));
    expect(first).toMatchObject({canFinish:false,action:'KEEP_PARENT_OPEN',acceptedRequiredCount:1,requiredCount:2});
    expect(first.missing.map(x=>x.task_id)).toEqual(['b']);
    const g=graph([a,accepted(b)]);
    expect(parentFinishDecision(g,{activeWriters:1}).reasons).toContain('ACTIVE_WRITER_OR_INVALID_COUNT');
    expect(parentFinishDecision(g,{ownerAcceptanceRequired:true,ownerAccepted:false}).reasons).toContain('OWNER_ACCEPTANCE_NOT_VERIFIED');
    expect(parentFinishDecision(g,{ownerAcceptanceRequired:true,ownerAccepted:true}))
      .toMatchObject({canFinish:true,action:'READY_TO_RECONCILE_NOT_DONE'});
    expect(g.tasks.every(t=>t.status==='accepted')).toBe(true);
  });

  it('does not require optional child acceptance for Parent completion',()=>{
    const g=graph([accepted(task('required')),task('optional',{required:false,status:'blocked'})]);
    expect(parentFinishDecision(g).canFinish).toBe(true);
  });
});
