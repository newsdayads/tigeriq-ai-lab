import { parseBacklog, type BacklogTask, type PlannerBacklog, type PlannerRuntimeState, type PlannerPriority, type PlannerRoute } from '../../autonomous-planner/src/core.js';
import { isActionClass, type ActionClass } from '../../autonomous-planner/src/policy.js';

export type MissionMode='ai'|'acceptance';
export interface Mission {missionId:string;goal:string;status:'pending'|'done'|'blocked';priority:PlannerPriority;mode:MissionMode;enabled:boolean;}
export interface MissionInbox {version:1;missions:Mission[];}
export interface MissionPlan {missionId:string;summary:string;model?:string;tasks:BacklogTask[];}
export interface MissionRuntimeRecord {stage:'planning'|'running'|'waiting_authorization'|'done'|'failed'|'blocked_plan';updatedAt:string;childTaskIds:string[];summary?:string;reason?:string;model?:string;}
export interface MissionRuntimeState {version:1;missions:Record<string,MissionRuntimeRecord>;lastCycleAt?:string;}

const missionIdPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const childIdPattern=/^[a-z][a-z0-9-]{0,39}$/;
const priorities:PlannerPriority[]=['P0','P1','P2','P3'];

function rec(value:unknown,name:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`INVALID_${name.toUpperCase()}`);return value as Record<string,unknown>;}
function str(value:unknown,name:string,max=4096):string{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`INVALID_${name.toUpperCase()}`);return value.trim();}
function arrStr(value:unknown,name:string,max=16):string[]{if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'))throw new Error(`INVALID_${name.toUpperCase()}`);return value.map(v=>(v as string).trim()).filter(Boolean);}

export function parseMissionInbox(raw:unknown):MissionInbox{
  const root=rec(raw,'mission_inbox');if(root.version!==1||!Array.isArray(root.missions)||root.missions.length>64)throw new Error('INVALID_MISSION_INBOX');
  const seen=new Set<string>();const missions=root.missions.map((v,i)=>{const r=rec(v,`mission_${i}`),missionId=str(r.missionId,'mission_id',64);if(!missionIdPattern.test(missionId)||seen.has(missionId))throw new Error('INVALID_OR_DUPLICATE_MISSION_ID');seen.add(missionId);const status=str(r.status??'pending','mission_status',16) as Mission['status'];if(!['pending','done','blocked'].includes(status))throw new Error('INVALID_MISSION_STATUS');const priority=str(r.priority??'P1','mission_priority',2) as PlannerPriority;if(!priorities.includes(priority))throw new Error('INVALID_MISSION_PRIORITY');const mode=str(r.mode??'ai','mission_mode',16) as MissionMode;if(!['ai','acceptance'].includes(mode))throw new Error('INVALID_MISSION_MODE');return {missionId,goal:str(r.goal,'mission_goal',12000),status,priority,mode,enabled:r.enabled!==false};});return {version:1,missions};
}

function fullId(missionId:string,id:string):string{return `${missionId}-${id}`;}
function missionPath(missionId:string,file:string):string{return `.tigeriq-runtime/missions/${missionId}/${file}`;}

export function acceptancePlan(mission:Mission):MissionPlan{
  const a=fullId(mission.missionId,'analysis-a'),b=fullId(mission.missionId,'analysis-b'),artifact=fullId(mission.missionId,'artifact'),review=fullId(mission.missionId,'review'),held=fullId(mission.missionId,'held-red');
  const base=(taskId:string,title:string,objective:string,priority:PlannerPriority,route:PlannerRoute,payload:Record<string,unknown>,dependencies:string[],actionClass?:ActionClass):BacklogTask=>({taskId,title,objective,status:'pending',priority,route,payload,requiredCapabilities:[],requiredPermissions:[],expectedEvidence:['json'],scopeKeys:[`mission/${mission.missionId}/${taskId}`],dependencies,requiresAuthorization:false,actionClass,enabled:true,maxAttempts:2});
  return {missionId:mission.missionId,summary:'Acceptance mission: parallel analysis -> artifact -> reviewer, plus a RED authorization hold.',model:'qwen3:8b',tasks:[
    base(a,'Mission Analyst A',`Role=Analyst A. Analyze this mission independently and return strict JSON with findings and next_actions. Mission: ${mission.goal}`,'P0','local_ai',{prompt:`Role: Analyst A. Mission: ${mission.goal}. Return JSON only: {"ok":true,"findings":["..."],"next_actions":["..."]}`,json:true},[],'LOCAL_AI'),
    base(b,'Mission Analyst B',`Role=Analyst B. Independently challenge assumptions for mission: ${mission.goal}`,'P0','local_ai',{prompt:`Role: Analyst B. Independently review mission: ${mission.goal}. Return JSON only: {"ok":true,"risks":["..."],"checks":["..."]}`,json:true},[],'LOCAL_AI'),
    base(artifact,'Mission Builder','Create deterministic mission artifact only after both analyses finish.','P1','tool',{toolRequest:{operation:'write_file',path:missionPath(mission.missionId,'deliverable.txt'),content:`TIGERIQ_AUTONOMY_DELIVERABLE\nMission: ${mission.goal}\nStatus: BUILDER_PASS`}},[a,b],'WORKSPACE_WRITE'),
    base(review,'Mission Reviewer','Review completion after builder artifact exists.','P1','local_ai',{prompt:`Role: Reviewer. Verify the mission execution contract conceptually for mission ${mission.missionId}. Return JSON only: {"review":"PASS","reason":"dependency graph completed before review"}`,json:true},[artifact],'LOCAL_AI'),
    base(held,'Authorization Boundary','This synthetic financial-class child must remain held and must never execute without explicit authorization.','P0','tool',{toolRequest:{operation:'write_file',path:missionPath(mission.missionId,'MUST_NOT_EXIST.txt'),content:'MUST_NOT_EXECUTE'}},[],'FINANCIAL')
  ]};
}

export function decompositionPrompt(mission:Mission):string{return `You are TigerIQ Mission Decomposer. Convert ONE mission into a small auditable DAG of 2-6 child tasks. Return JSON only.\nSchema: {"summary":"...","tasks":[{"id":"lowercase-id","title":"...","objective":"...","priority":"P0|P1|P2|P3","route":"local_ai|tool|deterministic","dependencies":["other-id"],"actionClass":"LOCAL_AI|WORKSPACE_READ|WORKSPACE_WRITE|SCRIPT_EXECUTION|FINANCIAL|SECURITY_SENSITIVE|DESTRUCTIVE|IRREVERSIBLE","payload":{}}]}\nRules: local_ai payload={"prompt":"...","json":true}; tool is ONLY read_file/write_file and path MUST start ${missionPath(mission.missionId,'')}; deterministic payload is ONLY {"action":"resource_snapshot"}. Never generate git/main/production, network writes, credentials, deletion, purchases, payments, or security changes. If the mission itself requests risky behavior, represent that child with the correct higher-risk actionClass so policy can HOLD it. Dependencies must be acyclic. Include a final reviewer local_ai task depending on the builder/output task.\nMission ID: ${mission.missionId}\nMission priority: ${mission.priority}\nMission goal: ${mission.goal}`;}

export function parseAiPlan(mission:Mission,raw:unknown,model='qwen3:8b'):MissionPlan{
  const root=rec(raw,'mission_plan');const rows=root.tasks;if(!Array.isArray(rows)||rows.length<2||rows.length>6)throw new Error('INVALID_PLAN_TASK_COUNT');const summary=str(root.summary,'plan_summary',2048);const shortIds=new Set<string>();
  const staged=rows.map((v,i)=>{const r=rec(v,`plan_task_${i}`),id=str(r.id,'plan_task_id',40);if(!childIdPattern.test(id)||shortIds.has(id))throw new Error('INVALID_OR_DUPLICATE_PLAN_TASK_ID');shortIds.add(id);const priority=str(r.priority??mission.priority,'plan_priority',2) as PlannerPriority;if(!priorities.includes(priority))throw new Error('INVALID_PLAN_PRIORITY');const route=str(r.route,'plan_route',16) as PlannerRoute;if(!['local_ai','tool','deterministic'].includes(route))throw new Error('INVALID_PLAN_ROUTE');const deps=arrStr(r.dependencies??[],'plan_dependencies',8);const payload=rec(r.payload??{},'plan_payload');let actionClass:ActionClass|undefined;if(r.actionClass!==undefined){if(!isActionClass(r.actionClass))throw new Error('INVALID_PLAN_ACTION_CLASS');actionClass=r.actionClass;}return {id,title:str(r.title,'plan_title',256),objective:str(r.objective,'plan_objective',2048),priority,route,deps,payload,actionClass};});
  for(const row of staged)for(const d of row.deps)if(!shortIds.has(d))throw new Error(`UNKNOWN_PLAN_DEPENDENCY:${d}`);
  const graph=new Map(staged.map(x=>[x.id,x.deps]));const visiting=new Set<string>(),done=new Set<string>();const visit=(id:string)=>{if(done.has(id))return;if(visiting.has(id))throw new Error('PLAN_DEPENDENCY_CYCLE');visiting.add(id);for(const d of graph.get(id)??[])visit(d);visiting.delete(id);done.add(id);};for(const id of graph.keys())visit(id);
  const tasks:BacklogTask[]=staged.map(row=>{const taskId=fullId(mission.missionId,row.id);if(row.route==='local_ai'){if(typeof row.payload.prompt!=='string'||!row.payload.prompt.trim())throw new Error(`PLAN_LOCAL_AI_PROMPT_REQUIRED:${row.id}`);row.actionClass=row.actionClass??'LOCAL_AI';}
    if(row.route==='deterministic'){if(row.payload.action!=='resource_snapshot')throw new Error(`PLAN_DETERMINISTIC_DENIED:${row.id}`);row.actionClass=row.actionClass??'WORKSPACE_READ';}
    if(row.route==='tool'){const req=rec(row.payload.toolRequest,'plan_tool_request'),op=str(req.operation,'plan_tool_operation',32);if(!['read_file','write_file'].includes(op))throw new Error(`PLAN_TOOL_DENIED:${op}`);const p=str(req.path,'plan_tool_path',512).replace(/\\/g,'/');const prefix=missionPath(mission.missionId,'');if(!p.startsWith(prefix)||p.includes('..'))throw new Error(`PLAN_TOOL_PATH_DENIED:${p}`);row.actionClass=row.actionClass??(op==='read_file'?'WORKSPACE_READ':'WORKSPACE_WRITE');}
    return {taskId,title:row.title,objective:row.objective,status:'pending',priority:row.priority,route:row.route,payload:row.payload,requiredCapabilities:[],requiredPermissions:[],expectedEvidence:['json'],scopeKeys:[`mission/${mission.missionId}/${taskId}`],dependencies:row.deps.map(d=>fullId(mission.missionId,d)),requiresAuthorization:false,actionClass:row.actionClass,enabled:true,maxAttempts:2};});
  return {missionId:mission.missionId,summary,model,tasks};
}

export function mergePlan(backlog:PlannerBacklog,plan:MissionPlan):PlannerBacklog{
  const existing=new Set(backlog.tasks.map(t=>t.taskId));const merged={version:1 as const,tasks:[...backlog.tasks,...plan.tasks.filter(t=>!existing.has(t.taskId))]};return parseBacklog(merged);
}

export function deriveMissionStage(plan:MissionPlan,planner:PlannerRuntimeState):MissionRuntimeRecord['stage']{
  const states=plan.tasks.map(t=>planner.tasks[t.taskId]);if(states.some(s=>s?.stage==='failed'))return 'failed';const executable=plan.tasks.filter((_,i)=>states[i]?.stage!=='held_authorization');const safeDone=executable.length>0&&executable.every((_,i)=>{const originalIndex=plan.tasks.indexOf(executable[i]);return states[originalIndex]?.stage==='done';});const held=states.some(s=>s?.stage==='held_authorization');if(safeDone&&held)return 'waiting_authorization';if(states.length>0&&states.every(s=>s?.stage==='done'))return 'done';return 'running';
}
