import { describe, expect, it } from 'vitest';
import {
  duplicateDispatchGuard,
  noProgressGuard,
  noProgressSignature,
  rankBacklogTask,
  reconcileSchedulerEvent,
  releaseBlockedStepLease,
  selectDispatch,
  workStealPlan,
} from '../apps/tigeriq-core/continuous-scheduler.mjs';

const now=Date.parse('2026-10-08T05:00:00+07:00');
const resources=[
  {id:'NV13',health:'ready',capability:['reasoning'],skills:['scheduler'],success_rate:0.98,latency_ms:800,current_work:null},
  {id:'NV17',health:'ready',capability:['reasoning'],skills:['scheduler','planning'],success_rate:0.95,latency_ms:400,current_work:null},
];

function task(overrides={}){
  return {
    id:'T-1',
    objective_id:'OBJ-1',
    title:'task',
    state:'ready',
    priority:'P1',
    dependencies:[],
    capability:'reasoning',
    skills:['scheduler'],
    resource_scope:'SCOPE-1',
    critical_path:false,
    unblock_value:0,
    created_at:'2026-10-08T04:00:00+07:00',
    blocked_reason:null,
    owner_hold:false,
    hard_gate:false,
    lease_id:null,
    lease_until:null,
    ...overrides,
  };
}

describe('Core vNext continuous scheduler',()=>{
  it('keeps P1 above P2 even when lower priority work is older or high-unblock',()=>{
    const p1=task({id:'P1',priority:'P1',created_at:'2026-10-08T04:59:00+07:00'});
    const p2=task({id:'P2',priority:'P2',created_at:'2026-10-01T00:00:00+07:00',critical_path:true,unblock_value:999});
    const result=selectDispatch({tasks:[p2,p1],resources,nowMs:now});
    expect(result.action).toBe('dispatch');
    expect(result.candidate.taskId).toBe('P1');
  });

  it('ranks critical path, unblock value, aging then resource fit inside the same priority',()=>{
    const ordinary=rankBacklogTask(task({id:'ordinary'}),resources[0],now);
    const critical=rankBacklogTask(task({id:'critical',critical_path:true}),resources[0],now);
    expect(critical.criticalPath).toBeGreaterThan(ordinary.criticalPath);

    const result=selectDispatch({
      tasks:[
        task({id:'old',created_at:'2026-10-08T01:00:00+07:00'}),
        task({id:'unblock',unblock_value:3,created_at:'2026-10-08T04:30:00+07:00'}),
        task({id:'critical',critical_path:true,created_at:'2026-10-08T04:50:00+07:00'}),
      ],
      resources,
      nowMs:now,
    });
    expect(result.candidate.taskId).toBe('critical');
  });

  it('releases blocked-step lease without parking sibling work',()=>{
    const blocked=releaseBlockedStepLease(task({
      id:'blocked',
      state:'blocked',
      lease_id:'lease-1',
      lease_until:'2026-10-08T06:00:00+07:00',
      assigned_resource:'NV13',
      blocked_reason:'external_dependency',
    }));
    expect(blocked.released).toBe(true);
    expect(blocked.task.lease_id).toBeNull();
    expect(blocked.task.assigned_resource).toBeNull();

    const sibling=task({id:'sibling',resource_scope:'SCOPE-2'});
    const result=selectDispatch({tasks:[blocked.task,sibling],resources,nowMs:now});
    expect(result.candidate.taskId).toBe('sibling');
  });

  it('guards duplicate dispatch and repeated no-progress loops',()=>{
    const row=task({id:'dup'});
    const key='OBJ-1|dup|SCOPE-1';
    expect(duplicateDispatchGuard(row,[key])).toMatchObject({allowed:false,reason:'duplicate_dispatch'});

    const signature=noProgressSignature({tasks:[row],resources});
    const once=noProgressGuard({previousSignature:signature,currentSignature:signature,repeatCount:0,maxRepeats:1});
    const twice=noProgressGuard({previousSignature:signature,currentSignature:signature,repeatCount:once.repeatCount,maxRepeats:1});
    expect(once.blocked).toBe(false);
    expect(twice.blocked).toBe(true);
  });

  it('reconciles on task/resource/health/new-work events only',()=>{
    for(const type of ['task_done','task_failed','task_blocked','resource_free','health_change','new_work']){
      expect(reconcileSchedulerEvent({type}).reconcile).toBe(true);
    }
    expect(reconcileSchedulerEvent({type:'heartbeat'}).reconcile).toBe(false);
  });

  it('work-steals across free resources while respecting capability and active dispatch guards',()=>{
    const tasks=[
      task({id:'A',resource_scope:'A',skills:['scheduler','planning']}),
      task({id:'B',resource_scope:'B'}),
      task({id:'C',resource_scope:'C',capability:'coding'}),
    ];
    const plan=workStealPlan({tasks,resources,nowMs:now,maxDispatches:3,activeDispatchKeys:['OBJ-1|B|B']});
    expect(plan.dispatches).toHaveLength(1);
    expect(plan.dispatches[0]).toMatchObject({taskId:'A',resourceId:'NV17'});
  });
});
