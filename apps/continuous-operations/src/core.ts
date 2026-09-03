import type { Mission, MissionInbox, MissionMode, MissionRuntimeRecord, MissionRuntimeState } from '../../mission-orchestrator/src/core.js';
import type { PlannerPriority } from '../../autonomous-planner/src/core.js';

export type ContinuousGoalStage='queued'|'waiting_dependency'|'injected'|'running'|'waiting_authorization'|'done'|'failed'|'blocked_plan'|'disabled';

export interface ContinuousGoal {
  goalId:string;
  goal:string;
  priority:PlannerPriority;
  mode:MissionMode;
  enabled:boolean;
  dependencies:string[];
}

export interface ContinuousGoalQueue {version:1;goals:ContinuousGoal[];}
export interface ContinuousGoalRuntimeRecord {stage:ContinuousGoalStage;updatedAt:string;missionId:string;reason?:string;}
export interface ContinuousRuntimeState {version:1;goals:Record<string,ContinuousGoalRuntimeRecord>;lastCycleAt?:string;paused?:boolean;}
export interface ContinuousControl {version:1;paused:boolean;}

const goalIdPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const priorities:PlannerPriority[]=['P0','P1','P2','P3'];

function rec(value:unknown,name:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`INVALID_${name.toUpperCase()}`);return value as Record<string,unknown>;}
function str(value:unknown,name:string,max:number):string{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`INVALID_${name.toUpperCase()}`);return value.trim();}

export function missionIdForGoal(goalId:string):string{return `OPS-${goalId}`;}

export function parseContinuousGoalQueue(raw:unknown):ContinuousGoalQueue{
  const root=rec(raw,'continuous_goal_queue');
  if(root.version!==1||!Array.isArray(root.goals)||root.goals.length>64)throw new Error('INVALID_CONTINUOUS_GOAL_QUEUE');
  const ids=new Set<string>();
  const goals=root.goals.map((value,index)=>{
    const row=rec(value,`goal_${index}`);
    const goalId=str(row.goalId,'goal_id',48);
    if(!goalIdPattern.test(goalId)||ids.has(goalId))throw new Error('INVALID_OR_DUPLICATE_GOAL_ID');
    ids.add(goalId);
    const priority=str(row.priority??'P1','goal_priority',2) as PlannerPriority;
    if(!priorities.includes(priority))throw new Error('INVALID_GOAL_PRIORITY');
    const mode=str(row.mode??'ai','goal_mode',16) as MissionMode;
    if(!['ai','acceptance'].includes(mode))throw new Error('INVALID_GOAL_MODE');
    const dependencies=row.dependencies??[];
    if(!Array.isArray(dependencies)||dependencies.length>8||dependencies.some(v=>typeof v!=='string'||!v.trim()))throw new Error('INVALID_GOAL_DEPENDENCIES');
    return {goalId,goal:str(row.goal,'goal',12000),priority,mode,enabled:row.enabled!==false,dependencies:(dependencies as string[]).map(v=>v.trim())};
  });
  for(const goal of goals)for(const dependency of goal.dependencies)if(!ids.has(dependency)||dependency===goal.goalId)throw new Error(`INVALID_GOAL_DEPENDENCY:${goal.goalId}:${dependency}`);
  const graph=new Map(goals.map(goal=>[goal.goalId,goal.dependencies]));
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string)=>{if(done.has(id))return;if(visiting.has(id))throw new Error('GOAL_DEPENDENCY_CYCLE');visiting.add(id);for(const dependency of graph.get(id)??[])visit(dependency);visiting.delete(id);done.add(id);};
  for(const id of graph.keys())visit(id);
  return {version:1,goals};
}

export function parseContinuousControl(raw:unknown):ContinuousControl{
  const root=rec(raw,'continuous_control');
  if(root.version!==1||typeof root.paused!=='boolean')throw new Error('INVALID_CONTINUOUS_CONTROL');
  return {version:1,paused:root.paused};
}

function stageFromMission(record:MissionRuntimeRecord|undefined):ContinuousGoalStage|undefined{
  if(!record)return undefined;
  if(record.stage==='planning'||record.stage==='running')return 'running';
  if(record.stage==='waiting_authorization')return 'waiting_authorization';
  if(record.stage==='done')return 'done';
  if(record.stage==='failed')return 'failed';
  if(record.stage==='blocked_plan')return 'blocked_plan';
  return undefined;
}

export function reconcileContinuousState(queue:ContinuousGoalQueue,prior:ContinuousRuntimeState|undefined,missions:MissionRuntimeState,now=new Date().toISOString()):ContinuousRuntimeState{
  const next:ContinuousRuntimeState={version:1,goals:{},lastCycleAt:prior?.lastCycleAt,paused:prior?.paused??false};
  for(const goal of queue.goals){
    const missionId=missionIdForGoal(goal.goalId);
    if(!goal.enabled){next.goals[goal.goalId]={stage:'disabled',updatedAt:now,missionId};continue;}
    const fromMission=stageFromMission(missions.missions[missionId]);
    if(fromMission){next.goals[goal.goalId]={stage:fromMission,updatedAt:now,missionId,reason:missions.missions[missionId]?.reason};continue;}
    const previous=prior?.goals[goal.goalId];
    const unresolved=goal.dependencies.some(id=>next.goals[id]?.stage!=='done'&&(prior?.goals[id]?.stage!=='done'));
    if(unresolved){next.goals[goal.goalId]={stage:'waiting_dependency',updatedAt:now,missionId};continue;}
    if(previous?.stage==='injected'||previous?.stage==='running'){next.goals[goal.goalId]={...previous,missionId};continue;}
    if(previous&&['done','failed','blocked_plan','waiting_authorization'].includes(previous.stage)){next.goals[goal.goalId]={...previous,missionId};continue;}
    next.goals[goal.goalId]={stage:'queued',updatedAt:now,missionId};
  }
  return next;
}

const priorityRank:Record<PlannerPriority,number>={P0:0,P1:1,P2:2,P3:3};
export function selectNextGoal(queue:ContinuousGoalQueue,state:ContinuousRuntimeState):ContinuousGoal|undefined{
  const active=Object.values(state.goals).some(record=>record.stage==='injected'||record.stage==='running');
  if(active)return undefined;
  return queue.goals
    .filter(goal=>goal.enabled&&state.goals[goal.goalId]?.stage==='queued')
    .map((goal,index)=>({goal,index}))
    .sort((a,b)=>priorityRank[a.goal.priority]-priorityRank[b.goal.priority]||a.index-b.index)[0]?.goal;
}

export function goalToMission(goal:ContinuousGoal):Mission{
  return {missionId:missionIdForGoal(goal.goalId),goal:goal.goal,status:'pending',priority:goal.priority,mode:goal.mode,enabled:true};
}

export function upsertMission(inbox:MissionInbox,mission:Mission):MissionInbox{
  const index=inbox.missions.findIndex(item=>item.missionId===mission.missionId);
  if(index<0){if(inbox.missions.length>=64)throw new Error('MISSION_INBOX_CAPACITY');return {version:1,missions:[...inbox.missions,mission]};}
  const missions=[...inbox.missions];
  if(missions[index].status!=='pending')throw new Error(`MISSION_ALREADY_TERMINAL:${mission.missionId}`);
  missions[index]={...missions[index],goal:mission.goal,priority:mission.priority,mode:mission.mode,enabled:true};
  return {version:1,missions};
}

export function reconcileMissionInbox(inbox:MissionInbox,missionState:MissionRuntimeState):MissionInbox{
  return {version:1,missions:inbox.missions.map(mission=>{
    const stage=missionState.missions[mission.missionId]?.stage;
    if(stage==='done')return {...mission,status:'done' as const};
    if(stage==='failed'||stage==='blocked_plan')return {...mission,status:'blocked' as const};
    return mission;
  })};
}
