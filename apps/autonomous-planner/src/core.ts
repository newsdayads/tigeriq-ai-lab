import { evaluatePolicy,isActionClass,type ActionClass,type AuthorizationStore,type PolicyDecision } from './policy.js';

export type PlannerPriority='P0'|'P1'|'P2'|'P3';
export type PlannerRoute='local_ai'|'tool'|'deterministic';
export type BacklogStatus='pending'|'done'|'blocked';

export interface BacklogTask {
  taskId:string;
  title:string;
  objective:string;
  status:BacklogStatus;
  priority:PlannerPriority;
  route:PlannerRoute;
  payload:Record<string,unknown>;
  requiredCapabilities:string[];
  requiredPermissions:string[];
  expectedEvidence:Array<'text'|'json'|'log'>;
  scopeKeys:string[];
  dependencies:string[];
  requiresAuthorization:boolean;
  actionClass?:ActionClass;
  enabled:boolean;
  maxAttempts:number;
}

export interface PlannerBacklog { version:1; tasks:BacklogTask[]; }
export type RuntimeTaskStage='ready'|'held_authorization'|'waiting_dependency'|'dispatched'|'done'|'failed';
export interface RuntimeTaskState { stage:RuntimeTaskStage; controllerJobId?:string; updatedAt:string; reason?:string; policy?:PolicyDecision; }
export interface PlannerRuntimeState { version:1; tasks:Record<string,RuntimeTaskState>; lastCycleAt?:string; }

const priorities:Record<PlannerPriority,number>={P0:0,P1:1,P2:2,P3:3};
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const deniedPath=/(^|[\\/])(\.git|\.env(?:\.|$)|credentials?|secrets?)([\\/]|$)/i;

function text(value:unknown,name:string,max=4096):string{
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`INVALID_${name.toUpperCase()}`);
  return value.trim();
}
function strings(value:unknown,name:string,max=64):string[]{
  if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'))throw new Error(`INVALID_${name.toUpperCase()}`);
  return value.map(v=>(v as string).trim()).filter(Boolean);
}
function record(value:unknown,name:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`INVALID_${name.toUpperCase()}`);return value as Record<string,unknown>;}

export function parseBacklog(raw:unknown):PlannerBacklog{
  const root=record(raw,'backlog');if(root.version!==1||!Array.isArray(root.tasks))throw new Error('INVALID_BACKLOG_VERSION');
  const seen=new Set<string>();
  const tasks=root.tasks.map((value,index)=>{
    const row=record(value,`task_${index}`),taskId=text(row.taskId,'task_id',128);
    if(!idPattern.test(taskId)||seen.has(taskId))throw new Error('INVALID_OR_DUPLICATE_TASK_ID');seen.add(taskId);
    const status=text(row.status,'status',16) as BacklogStatus;if(!['pending','done','blocked'].includes(status))throw new Error('INVALID_STATUS');
    const priority=text(row.priority,'priority',2) as PlannerPriority;if(!(priority in priorities))throw new Error('INVALID_PRIORITY');
    const route=text(row.route,'route',32) as PlannerRoute;if(!['local_ai','tool','deterministic'].includes(route))throw new Error('INVALID_ROUTE');
    const evidence=strings(row.expectedEvidence??['json'],'expected_evidence',8) as BacklogTask['expectedEvidence'];if(evidence.length===0||evidence.some(k=>!['text','json','log'].includes(k)))throw new Error('INVALID_EXPECTED_EVIDENCE');
    const maxAttempts=Number(row.maxAttempts??2);if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)throw new Error('INVALID_MAX_ATTEMPTS');
    let actionClass:ActionClass|undefined;if(row.actionClass!==undefined){if(!isActionClass(row.actionClass))throw new Error('INVALID_ACTION_CLASS');actionClass=row.actionClass;}
    const task:BacklogTask={taskId,title:text(row.title,'title',512),objective:text(row.objective,'objective'),status,priority,route,payload:record(row.payload??{},'payload'),requiredCapabilities:strings(row.requiredCapabilities??[],'required_capabilities'),requiredPermissions:strings(row.requiredPermissions??[],'required_permissions'),expectedEvidence:evidence,scopeKeys:strings(row.scopeKeys??[`autonomy/${taskId}`],'scope_keys'),dependencies:strings(row.dependencies??[],'dependencies'),requiresAuthorization:Boolean(row.requiresAuthorization),actionClass,enabled:row.enabled!==false,maxAttempts};
    validatePayload(task);return task;
  });
  for(const task of tasks)for(const dep of task.dependencies)if(!seen.has(dep))throw new Error(`UNKNOWN_DEPENDENCY:${dep}`);
  return {version:1,tasks};
}

function validatePayload(task:BacklogTask):void{
  if(task.route==='local_ai'){
    if(typeof task.payload.prompt!=='string'||!task.payload.prompt.trim())throw new Error(`LOCAL_AI_PROMPT_REQUIRED:${task.taskId}`);
    return;
  }
  if(task.route==='deterministic'){
    if(task.payload.action!=='resource_snapshot')throw new Error(`DETERMINISTIC_ACTION_DENIED:${task.taskId}`);
    return;
  }
  const raw=Array.isArray(task.payload.toolRequests)?task.payload.toolRequests:[task.payload.toolRequest];
  if(raw.length<1||raw.length>16)throw new Error(`TOOL_REQUEST_REQUIRED:${task.taskId}`);
  for(const item of raw){const req=record(item,'tool_request'),op=text(req.operation,'operation',32);if(!['read_file','write_file','git','npm','node','python','http'].includes(op))throw new Error(`TOOL_OPERATION_DENIED:${op}`);if((op==='read_file'||op==='write_file')&&typeof req.path==='string'&&(deniedPath.test(req.path)||req.path.includes('..')))throw new Error(`TOOL_PATH_DENIED:${task.taskId}`);if(op==='git'&&String(req.action).toLowerCase()==='checkout'&&['main','master','production','prod'].includes(String(req.branch).toLowerCase()))throw new Error(`PROTECTED_BRANCH_DENIED:${task.taskId}`);}
}

export function reconcile(backlog:PlannerBacklog,state:PlannerRuntimeState,authorizations:AuthorizationStore,now=new Date().toISOString()):PlannerRuntimeState{
  const next:PlannerRuntimeState={version:1,tasks:{...state.tasks},lastCycleAt:now};
  for(const task of backlog.tasks){
    const current=next.tasks[task.taskId];
    if(task.status==='done'){next.tasks[task.taskId]={stage:'done',updatedAt:now,reason:'backlog_done',policy:current?.policy};continue;}
    if(task.status==='blocked'){next.tasks[task.taskId]={stage:'failed',updatedAt:now,reason:'backlog_blocked',policy:current?.policy};continue;}
    const policy=evaluatePolicy(task,authorizations,now);
    if(current?.stage==='dispatched'||current?.stage==='done'||current?.stage==='failed'){next.tasks[task.taskId]={...current,policy};continue;}
    if(policy.decision==='HELD_AUTHORIZATION'){next.tasks[task.taskId]={stage:'held_authorization',updatedAt:now,reason:policy.reason,policy};continue;}
    next.tasks[task.taskId]={stage:'ready',updatedAt:now,reason:policy.reason,policy};
  }
  return next;
}

export function actionable(backlog:PlannerBacklog,state:PlannerRuntimeState,limit=2):BacklogTask[]{
  const done=(id:string)=>backlog.tasks.find(t=>t.taskId===id)?.status==='done'||state.tasks[id]?.stage==='done';
  return backlog.tasks.filter(task=>{
    if(!task.enabled||task.status!=='pending')return false;
    const runtime=state.tasks[task.taskId],stage=runtime?.stage;if(!runtime?.policy||runtime.policy.decision!=='AUTO_DISPATCH')return false;
    if(stage&&!['ready','waiting_dependency'].includes(stage))return false;
    return task.dependencies.every(done);
  }).sort((a,b)=>priorities[a.priority]-priorities[b.priority]||a.taskId.localeCompare(b.taskId)).slice(0,Math.max(1,limit));
}

export function waitingDependencies(backlog:PlannerBacklog,state:PlannerRuntimeState):string[]{
  const done=(id:string)=>backlog.tasks.find(t=>t.taskId===id)?.status==='done'||state.tasks[id]?.stage==='done';
  return backlog.tasks.filter(t=>{const runtime=state.tasks[t.taskId];return t.enabled&&t.status==='pending'&&runtime?.policy?.decision==='AUTO_DISPATCH'&&['ready','waiting_dependency'].includes(runtime.stage)&&t.dependencies.some(d=>!done(d));}).map(t=>t.taskId);
}

export function toControllerBody(task:BacklogTask):Record<string,unknown>{
  const routeCapabilities=task.route==='local_ai'?['local_ai','evidence']:task.route==='tool'?['filesystem','evidence']:['evidence'];
  const routePermissions=task.route==='local_ai'?['local_ai:execute','evidence:write']:task.route==='tool'?['workspace:read','workspace:write','evidence:write']:['evidence:write'];
  return {idempotencyKey:`autonomy:${task.taskId}:v1`,title:task.title,objective:task.objective,payload:{...task.payload,route:task.route},requiredCapabilities:task.requiredCapabilities.length?task.requiredCapabilities:routeCapabilities,requiredPermissions:task.requiredPermissions.length?task.requiredPermissions:routePermissions,allowedWorkerKinds:['pc01'],expectedEvidence:task.expectedEvidence,scopeKeys:task.scopeKeys.length?task.scopeKeys:[`autonomy/${task.taskId}`],maxAttempts:task.maxAttempts,independentReview:false,judgeRequired:false,priority:task.priority};
}
