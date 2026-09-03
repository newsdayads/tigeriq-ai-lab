import { describe, expect, it } from 'vitest';
import { goalToMission, missionIdForGoal, parseContinuousControl, parseContinuousGoalQueue, reconcileContinuousState, reconcileMissionInbox, selectNextGoal, upsertMission } from '../apps/continuous-operations/src/core.js';
import type { MissionInbox, MissionRuntimeState } from '../apps/mission-orchestrator/src/core.js';

const emptyMissionState:MissionRuntimeState={version:1,missions:{}};

describe('continuous operations queue',()=>{
  it('parses a bounded queue and never invents work',()=>{
    const queue=parseContinuousGoalQueue({version:1,goals:[]});
    const state=reconcileContinuousState(queue,undefined,emptyMissionState,'2026-09-04T00:00:00.000Z');
    expect(queue.goals).toEqual([]);
    expect(selectNextGoal(queue,state)).toBeUndefined();
  });

  it('rejects dependency cycles',()=>{
    expect(()=>parseContinuousGoalQueue({version:1,goals:[
      {goalId:'a',goal:'A',priority:'P1',mode:'ai',dependencies:['b']},
      {goalId:'b',goal:'B',priority:'P1',mode:'ai',dependencies:['a']}
    ]})).toThrow('GOAL_DEPENDENCY_CYCLE');
  });

  it('selects highest priority eligible goal and runs one active mission at a time',()=>{
    const queue=parseContinuousGoalQueue({version:1,goals:[
      {goalId:'low',goal:'Low',priority:'P2',mode:'ai'},
      {goalId:'high',goal:'High',priority:'P0',mode:'ai'}
    ]});
    const state=reconcileContinuousState(queue,undefined,emptyMissionState,'2026-09-04T00:00:00.000Z');
    expect(selectNextGoal(queue,state)?.goalId).toBe('high');
    state.goals.high.stage='injected';
    expect(selectNextGoal(queue,state)).toBeUndefined();
  });

  it('waits for dependencies then unlocks the next goal',()=>{
    const queue=parseContinuousGoalQueue({version:1,goals:[
      {goalId:'first',goal:'First',priority:'P1',mode:'ai'},
      {goalId:'second',goal:'Second',priority:'P0',mode:'ai',dependencies:['first']}
    ]});
    let state=reconcileContinuousState(queue,undefined,emptyMissionState,'2026-09-04T00:00:00.000Z');
    expect(state.goals.second.stage).toBe('waiting_dependency');
    expect(selectNextGoal(queue,state)?.goalId).toBe('first');
    state={...state,goals:{...state.goals,first:{...state.goals.first,stage:'done'}}};
    const next=reconcileContinuousState(queue,state,emptyMissionState,'2026-09-04T00:01:00.000Z');
    expect(next.goals.second.stage).toBe('queued');
    expect(selectNextGoal(queue,next)?.goalId).toBe('second');
  });

  it('does not let authorization-held work block the next independent goal',()=>{
    const queue=parseContinuousGoalQueue({version:1,goals:[
      {goalId:'held',goal:'Held',priority:'P0',mode:'ai'},
      {goalId:'next',goal:'Next',priority:'P1',mode:'ai'}
    ]});
    const missions:MissionRuntimeState={version:1,missions:{[missionIdForGoal('held')]:{stage:'waiting_authorization',updatedAt:'2026-09-04T00:00:00.000Z',childTaskIds:['x']}}};
    const state=reconcileContinuousState(queue,undefined,missions,'2026-09-04T00:00:00.000Z');
    expect(state.goals.held.stage).toBe('waiting_authorization');
    expect(selectNextGoal(queue,state)?.goalId).toBe('next');
  });

  it('injects a deterministic mission id and preserves policy boundaries downstream',()=>{
    const queue=parseContinuousGoalQueue({version:1,goals:[{goalId:'safe-01',goal:'Build safe local artifact',priority:'P0',mode:'ai'}]});
    const mission=goalToMission(queue.goals[0]);
    expect(mission).toMatchObject({missionId:'OPS-safe-01',status:'pending',priority:'P0',mode:'ai',enabled:true});
    const inbox=upsertMission({version:1,missions:[]},mission);
    expect(inbox.missions).toHaveLength(1);
    expect(()=>upsertMission({version:1,missions:[{...mission,status:'done'}]},mission)).toThrow('MISSION_ALREADY_TERMINAL');
  });

  it('marks terminal mission inbox records while leaving authorization holds pending',()=>{
    const base={missionId:'OPS-a',goal:'A',status:'pending' as const,priority:'P1' as const,mode:'ai' as const,enabled:true};
    const held={...base,missionId:'OPS-b'};
    const inbox:MissionInbox={version:1,missions:[base,held]};
    const state:MissionRuntimeState={version:1,missions:{
      'OPS-a':{stage:'done',updatedAt:'2026-09-04T00:00:00.000Z',childTaskIds:['x']},
      'OPS-b':{stage:'waiting_authorization',updatedAt:'2026-09-04T00:00:00.000Z',childTaskIds:['y']}
    }};
    const next=reconcileMissionInbox(inbox,state);
    expect(next.missions[0].status).toBe('done');
    expect(next.missions[1].status).toBe('pending');
  });

  it('supports an explicit global pause switch',()=>{
    expect(parseContinuousControl({version:1,paused:true})).toEqual({version:1,paused:true});
    expect(()=>parseContinuousControl({version:1,paused:'yes'})).toThrow('INVALID_CONTINUOUS_CONTROL');
  });
});
