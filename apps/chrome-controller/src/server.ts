import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  loadConfig,
  computePlacements,
  isWorkerEnabled,
  isInteractiveDesktopSession,
  WORKER_IDS,
  type ControllerConfig,
  type WorkerId,
  type WorkArea,
} from './model.js';
import { delay, SerialQueue } from './serial-queue.js';
import {
  AUTO_CONTINUE,
  decideAutoContinue,
  freshAutopilotState,
  validateExternalSnapshot,
  type DurableAutopilotState,
  type ExternalAutopilotSnapshot,
} from './autopilot.js';
import { buildRuntimeEvidence } from './runtime-evidence.js';

type Command = { id:string; workerId:WorkerId; action:string; payload?:Record<string,unknown>; createdAt:string };
type Heartbeat = { workerId:WorkerId; url?:string; windowId?:number; tabId?:number; state?:string; uiBusy?:boolean|null; securityBlock?:string|null; display?:{workArea?:WorkArea}; at:string };
type WindowState = 'OPEN' | 'CLOSED';
type WorkerState = {
  id:WorkerId;
  enabled:boolean;
  status:string;
  blocked:boolean;
  lastHeartbeat?:Heartbeat;
  lastError?:string;
  windowState?:WindowState;
  windowEventAt?:string;
  lastWindowId?:number;
  manualCloseSuppressed?:boolean;
};
type Waiter = {
  workerId:WorkerId;
  action:string;
  delivered:boolean;
  resolve:(value:unknown)=>void;
  reject:(reason?:unknown)=>void;
  timer:NodeJS.Timeout;
};

const config = loadConfig(process.argv[2]);
const uiQueue = new SerialQueue(config.pacing.minUiActionGapMs);
const launchQueue = new SerialQueue(config.pacing.betweenWorkerLaunchMs);
const states = new Map<WorkerId,WorkerState>(config.workers.map((worker) => {
  const enabled = isWorkerEnabled(worker);
  return [worker.id, { id:worker.id, enabled, status:enabled?'IDLE':'DISABLED', blocked:false }];
}));
const commandQueues = new Map<WorkerId,Command[]>(config.workers.map((worker) => [worker.id, []]));
const waiters = new Map<string,Waiter>();
const recoveryAttempts = new Map<WorkerId,number>(WORKER_IDS.map((id) => [id,0]));
const recoveryInFlight = new Set<WorkerId>();
let paused=false;
let killed=false;
let startAllRunning=false;
let autopilotTicking=false;
let recoveryTicking=false;
let startupReady=false;
let lastAutopilotStopReason='';

mkdirSync(config.logDir,{recursive:true});
const logPath=resolve(config.logDir,'chrome-controller.jsonl');
const autopilotStatePath=resolve(config.logDir,'autopilot-state.json');
const autopilotSnapshotPath=resolve(config.logDir,'autopilot-snapshot.json');
const runtimeEvidencePath=resolve(config.logDir,'runtime-evidence.json');
const interactionStatePath=resolve(config.logDir,'owner-interaction-state.json');
const extensionPath=resolve(process.cwd(),'apps/chrome-controller/extension');

function log(event:string,data:Record<string,unknown>={}){
  const line=JSON.stringify({ts:new Date().toISOString(),event,...data});
  appendFileSync(logPath,`${line}\n`,'utf8');
  console.log(line);
}
function atomicJson(path:string,value:unknown){
  const temp=`${path}.tmp`;
  writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');
  renameSync(temp,path);
}
function loadJson<T>(path:string):T|undefined{
  if(!existsSync(path))return;
  try{return JSON.parse(readFileSync(path,'utf8')) as T;}
  catch(error){log('DURABLE_STATE_READ_FAILED',{path,error:String(error)});return;}
}
let autopilotState:DurableAutopilotState=loadJson<DurableAutopilotState>(autopilotStatePath)??freshAutopilotState();
let latestSnapshot:ExternalAutopilotSnapshot|undefined;
paused=loadJson<{readOnly?:boolean}>(interactionStatePath)?.readOnly===true;
try{
  const saved=loadJson<ExternalAutopilotSnapshot>(autopilotSnapshotPath);
  if(saved)latestSnapshot=validateExternalSnapshot(saved);
}catch(error){log('AUTOPILOT_SNAPSHOT_RESTORE_REJECTED',{error:String(error)});}
function persistAutopilotState(){atomicJson(autopilotStatePath,autopilotState);}
function persistInteractionState(){atomicJson(interactionStatePath,{readOnly:paused,updatedAt:new Date().toISOString()});}
function setOwnerInteractionReadOnly(readOnly:boolean){
  paused=readOnly;
  persistInteractionState();
  log(readOnly?'OWNER_INTERACTION_READ_ONLY':'OWNER_INTERACTION_AUTOMATION',{readOnly});
}
function setAutopilotPhase(phase:DurableAutopilotState['phase']){
  if(autopilotState.phase===phase)return;
  autopilotState={...autopilotState,phase,updatedAt:new Date().toISOString()};
  persistAutopilotState();
}
function stopAutopilot(reason:string){
  setAutopilotPhase('STOPPED');
  if(lastAutopilotStopReason!==reason){log('AUTOPILOT_STOP',{reason});lastAutopilotStopReason=reason;}
}
function clearPending(state:DurableAutopilotState):DurableAutopilotState{
  const {pendingJobId:_pendingJobId,pendingReservedAt:_pendingReservedAt,...rest}=state;
  return rest;
}

function json(res:ServerResponse,status:number,value:unknown){
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'access-control-allow-origin':'*',
    'access-control-allow-headers':'content-type',
    'access-control-allow-methods':'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(value));
}
async function body(req:IncomingMessage):Promise<Record<string,unknown>>{
  const chunks:Buffer[]=[];
  for await(const chunk of req)chunks.push(Buffer.from(chunk));
  return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>:{};
}
function getWorker(id:string):ReturnType<ControllerConfig['workers']['find']>{return config.workers.find((worker)=>worker.id===id);}
function heartbeatFresh(state:WorkerState|undefined){return Boolean(state?.lastHeartbeat&&Date.now()-Date.parse(state.lastHeartbeat.at)<config.recovery.heartbeatStaleMs);}
function recentHeartbeat(id:WorkerId){const state=states.get(id);return Boolean(state?.enabled&&heartbeatFresh(state));}
function assertWorkerEnabled(id:WorkerId){if(!states.get(id)?.enabled)throw new Error(`WORKER_DISABLED:${id}`);}
function setWorkerEnabled(id:WorkerId,enabled:boolean){
  const state=states.get(id)!;
  if(state.enabled===enabled)return;
  state.enabled=enabled;
  recoveryAttempts.set(id,0);
  if(!enabled){
    commandQueues.get(id)!.splice(0);
    for(const[commandId,waiter]of waiters){
      if(waiter.workerId!==id)continue;
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`WORKER_DISABLED:${id}`));
      waiters.delete(commandId);
    }
    state.status='DISABLED';
    state.lastError=undefined;
    state.manualCloseSuppressed=true;
    log('WORKER_DISABLED',{workerId:id});
    return;
  }
  state.manualCloseSuppressed=false;
  state.status=state.blocked?'BLOCKED':heartbeatFresh(state)?'ONLINE':'IDLE';
  if(!state.blocked)state.lastError=undefined;
  log('WORKER_ENABLED',{workerId:id});
}
function effectiveWorkArea():WorkArea|undefined{
  for(const id of WORKER_IDS){
    const state=states.get(id);
    const area=state?.lastHeartbeat?.display?.workArea;
    if(state?.enabled&&area?.width&&area?.height)return area;
  }
  return undefined;
}
function evidence(){
  return buildRuntimeEvidence({
    config,
    workArea:effectiveWorkArea(),
    workers:[...states.values()],
    autopilot:autopilotState,
    snapshot:latestSnapshot,
    paused,
    killed,
    recoveryAttempts:Object.fromEntries(recoveryAttempts) as Partial<Record<WorkerId,number>>,
    startupReady,
    interactiveSession:isInteractiveDesktopSession(),
    sessionName:process.env.SESSIONNAME??null,
  });
}
function persistEvidence(){const value=evidence();atomicJson(runtimeEvidencePath,value);return value;}

function assertVisibleChromeLaunch(){
  if(!isInteractiveDesktopSession())throw new Error('INTERACTIVE_SESSION_REQUIRED:NO_HIDDEN_CHROME');
}
function launchChrome(workerId:WorkerId){
  assertWorkerEnabled(workerId);
  assertVisibleChromeLaunch();
  const worker=getWorker(workerId);
  if(!worker)throw new Error(`UNKNOWN_WORKER:${workerId}`);
  if(!existsSync(extensionPath))throw new Error('CONTROLLER_EXTENSION_PATH_MISSING');
  const placement=computePlacements(config,effectiveWorkArea())[workerId];
  const args:string[]=[];
  const userDataDir=worker.userDataDir??config.userDataDir;
  if(userDataDir)args.push(`--user-data-dir=${userDataDir}`);
  args.push(
    `--load-extension=${extensionPath}`,
    `--profile-directory=${worker.profileDirectory}`,
    '--disable-session-crashed-bubble',
    '--new-window',
    `--window-position=${placement.left},${placement.top}`,
    `--window-size=${placement.width},${placement.height}`,
    worker.homeUrl,
  );
  const child=spawn(config.chromePath,args,{detached:false,windowsHide:false,stdio:'ignore'});
  child.unref();
  const state=states.get(workerId)!;
  state.status='STARTING';
  state.windowState='OPEN';
  state.windowEventAt=new Date().toISOString();
  state.manualCloseSuppressed=false;
  log('CHROME_LAUNCH_VISIBLE',{workerId,profileDirectory:worker.profileDirectory,placement,extensionLoaded:true,disableSessionCrashedBubble:true,sessionName:process.env.SESSIONNAME??null});
}
async function waitForHeartbeat(workerId:WorkerId){
  const deadline=Date.now()+config.pacing.workerReadyTimeoutMs;
  while(Date.now()<deadline){
    assertWorkerEnabled(workerId);
    if(recentHeartbeat(workerId))return;
    await delay(1000);
  }
  throw new Error(`WORKER_HEARTBEAT_TIMEOUT:${workerId}`);
}
function removeQueuedCommand(workerId:WorkerId,commandId:string){
  const queue=commandQueues.get(workerId)!;
  const index=queue.findIndex((item)=>item.id===commandId);
  if(index>=0)queue.splice(index,1);
}
function sendCommand(workerId:WorkerId,action:string,payload?:Record<string,unknown>):Promise<unknown>{
  const state=states.get(workerId)!;
  assertWorkerEnabled(workerId);
  if(killed)return Promise.reject(new Error('CONTROLLER_KILLED'));
  if(paused)return Promise.reject(new Error('OWNER_INTERACTION_READ_ONLY'));
  if(state.blocked&&!['FOCUS','LAYOUT'].includes(action))return Promise.reject(new Error(`WORKER_BLOCKED:${workerId}`));
  const command:Command={id:randomUUID(),workerId,action,payload,createdAt:new Date().toISOString()};
  commandQueues.get(workerId)!.push(command);
  log('COMMAND_QUEUED',{workerId,commandId:command.id,action});
  return new Promise((resolvePromise,rejectPromise)=>{
    const waiter={} as Waiter;
    waiter.workerId=workerId;
    waiter.action=action;
    waiter.delivered=false;
    waiter.resolve=resolvePromise;
    waiter.reject=rejectPromise;
    waiter.timer=setTimeout(()=>{
      if(!waiters.has(command.id))return;
      waiters.delete(command.id);
      if(!waiter.delivered)removeQueuedCommand(workerId,command.id);
      const delivery=waiter.delivered?'DELIVERED':'NOT_DELIVERED';
      rejectPromise(new Error(`COMMAND_TIMEOUT_${delivery}:${action}:${workerId}`));
    },config.pacing.commandTimeoutMs);
    waiters.set(command.id,waiter);
  });
}
async function runWithRetry<T>(label:string,task:()=>Promise<T>):Promise<T>{
  let lastError:unknown;
  for(let attempt=0;attempt<=config.pacing.maxRetries;attempt+=1){
    try{return await task();}
    catch(error){
      lastError=error;
      log('ACTION_RETRY',{label,attempt,error:String(error)});
      if(attempt<config.pacing.maxRetries)await delay(config.pacing.retryBackoffMs*(attempt+1));
    }
  }
  throw lastError;
}
async function layoutWorker(workerId:WorkerId){
  assertWorkerEnabled(workerId);
  const placement=computePlacements(config,effectiveWorkArea())[workerId];
  return uiQueue.enqueue(()=>runWithRetry(`layout:${workerId}`,()=>sendCommand(workerId,'LAYOUT',placement as unknown as Record<string,unknown>)));
}
function canLaunchWorker(state:WorkerState){return !state.lastHeartbeat||state.windowState==='CLOSED';}
async function startWorker(workerId:WorkerId){
  assertWorkerEnabled(workerId);
  if(paused)throw new Error('OWNER_INTERACTION_READ_ONLY');
  const state=states.get(workerId)!;
  state.manualCloseSuppressed=false;
  await launchQueue.enqueue(async()=>{
    assertWorkerEnabled(workerId);
    if(!recentHeartbeat(workerId)){
      if(!canLaunchWorker(state))throw new Error(`RECOVERY_AMBIGUOUS_WINDOW:${workerId}`);
      launchChrome(workerId);
    }
    await waitForHeartbeat(workerId);
    await delay(config.pacing.postReadySettlingMs);
    assertWorkerEnabled(workerId);
    await layoutWorker(workerId);
    state.status='READY';
    state.lastError=undefined;
    state.windowState='OPEN';
    state.manualCloseSuppressed=false;
    recoveryAttempts.set(workerId,0);
    log('WORKER_READY',{workerId});
    persistEvidence();
  });
}

async function dispatch(workerId:WorkerId,text:string,navigate:boolean,source:'MANUAL'|'AUTO_CONTINUE'='MANUAL'){
  assertWorkerEnabled(workerId);
  if(!text.trim())throw new Error('DISPATCH_TEXT_REQUIRED');
  const worker=getWorker(workerId)!;
  states.get(workerId)!.status=source==='AUTO_CONTINUE'?'AUTOPILOT_DISPATCHING':'DISPATCHING';
  return uiQueue.enqueue(async()=>{
    try{
      assertWorkerEnabled(workerId);
      if(navigate)await runWithRetry(`navigate:${workerId}`,()=>sendCommand(workerId,'NAVIGATE',{url:worker.homeUrl}));
      const result=await sendCommand(workerId,'DISPATCH',{text});
      states.get(workerId)!.status='SUBMITTED';
      states.get(workerId)!.lastError=undefined;
      log(source==='AUTO_CONTINUE'?'AUTO_CONTINUE_SUBMITTED':'WORK_ORDER_SUBMITTED',{
        workerId,
        trigger:source==='AUTO_CONTINUE'?AUTO_CONTINUE:undefined,
        chars:text.length,
      });
      persistEvidence();
      return result;
    }catch(error){
      const state=states.get(workerId)!;
      if(state.enabled&&!state.blocked)state.status='ERROR';
      state.lastError=String(error);
      throw error;
    }
  });
}

function snapshotRequiredWorkers():WorkerId[]{return latestSnapshot?.requiredWorkers?.filter((id)=>states.get(id)?.enabled)??[];}
function workerHasActiveJob(id:WorkerId){
  if(id==='NV02'){
    if(autopilotState.pendingJobId||autopilotState.uncertainJobId)return true;
    const previous=latestSnapshot?.previousJob;
    return Boolean(previous&&previous.workerId==='NV02'&&previous.jobId===autopilotState.lastDispatchedJobId&&['QUEUED','READY','RUNNING'].includes(previous.status));
  }
  return snapshotRequiredWorkers().includes(id);
}
function workerNeeded(id:WorkerId){
  const state=states.get(id);
  if(!state?.enabled||state.manualCloseSuppressed)return false;
  if(id==='NV02')return true;
  return snapshotRequiredWorkers().includes(id)||workerHasActiveJob(id);
}
async function fetchExternalSnapshot(){
  if(!config.autopilot.stateUrl)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),config.autopilot.requestTimeoutMs);
  try{
    const response=await fetch(config.autopilot.stateUrl,{signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP_${response.status}`);
    const snapshot=validateExternalSnapshot(await response.json());
    latestSnapshot=snapshot;
    atomicJson(autopilotSnapshotPath,snapshot);
    log('AUTOPILOT_SNAPSHOT_PULLED',{source:snapshot.source,revision:snapshot.revision});
  }finally{clearTimeout(timer);}
}
async function autopilotTick(){
  if(autopilotTicking||!config.autopilot.enabled||paused||killed)return;
  autopilotTicking=true;
  try{
    if(config.autopilot.stateUrl){
      try{await fetchExternalSnapshot();}
      catch(error){log('AUTOPILOT_EXTERNAL_STATE_UNAVAILABLE',{error:String(error)});}
    }
    if(!latestSnapshot){setAutopilotPhase('IDLE');persistEvidence();return;}
    const previous=latestSnapshot.previousJob;
    if(previous&&previous.jobId===autopilotState.lastDispatchedJobId&&previous.status==='DONE'){
      const ext=previous.evidence?.find((item)=>['GITHUB','CORE'].includes(item.source)&&Boolean(item.ref?.trim())&&Boolean(item.verifiedAt));
      if(ext&&autopilotState.lastCompletedJobId!==previous.jobId){
        autopilotState={...autopilotState,lastCompletedJobId:previous.jobId,lastEvidenceRef:ext.ref,updatedAt:new Date().toISOString()};
        persistAutopilotState();
        log('COMPLETION_WATCHER_DONE_EVIDENCE',{jobId:previous.jobId,evidenceRef:ext.ref,source:ext.source});
      }
    }
    const decision=decideAutoContinue(latestSnapshot,autopilotState,Date.now(),config.autopilot.maxSnapshotAgeMs);
    if(decision.kind==='IDLE'){lastAutopilotStopReason='';setAutopilotPhase('IDLE');persistEvidence();return;}
    if(decision.kind==='BUSY'||decision.kind==='DUPLICATE_NOOP'){lastAutopilotStopReason='';setAutopilotPhase('BUSY');persistEvidence();return;}
    if(decision.kind==='WAIT_EVIDENCE'){lastAutopilotStopReason='';setAutopilotPhase('WAIT_EVIDENCE');persistEvidence();return;}
    if(decision.kind==='STOP'){stopAutopilot(decision.reason);persistEvidence();return;}
    const primary=states.get('NV02')!;
    if(!primary.enabled||primary.blocked||!startupReady){stopAutopilot(primary.blocked?'NV02_BLOCKED':'NV02_NOT_READY');persistEvidence();return;}
    if(!recentHeartbeat('NV02')){setAutopilotPhase('RECOVERING');persistEvidence();return;}
    const uiSecurity=primary.lastHeartbeat?.securityBlock;
    if(uiSecurity&&uiSecurity.startsWith('BLOCKED_')){
      primary.blocked=true;primary.status='BLOCKED';primary.lastError=uiSecurity;
      stopAutopilot(uiSecurity);log('AUTOPILOT_SECURITY_STOP',{workerId:'NV02',status:uiSecurity});persistEvidence();return;
    }
    if(autopilotState.lastDispatchedJobId&&primary.lastHeartbeat?.uiBusy!==false){
      setAutopilotPhase('BUSY');
      log('AUTOPILOT_WAIT_UI_BUSY',{workerId:'NV02',uiBusy:primary.lastHeartbeat?.uiBusy??null,lastDispatchedJobId:autopilotState.lastDispatchedJobId});
      persistEvidence();return;
    }
    autopilotState={
      ...autopilotState,
      phase:'BUSY',
      pendingJobId:decision.jobId,
      pendingReservedAt:new Date().toISOString(),
      lastEvidenceRef:decision.evidenceRef??autopilotState.lastEvidenceRef,
      lastTrigger:AUTO_CONTINUE,
      updatedAt:new Date().toISOString(),
    };
    persistAutopilotState();
    log('AUTO_CONTINUE_RESERVED',{jobId:decision.jobId,trigger:AUTO_CONTINUE,evidenceRef:decision.evidenceRef??null});
    try{
      await dispatch('NV02',decision.text,true,'AUTO_CONTINUE');
      autopilotState={
        ...clearPending(autopilotState),
        phase:'BUSY',
        lastDispatchedJobId:decision.jobId,
        uncertainJobId:undefined,
        updatedAt:new Date().toISOString(),
      };
      persistAutopilotState();
      log('AUTO_CONTINUE_COMMITTED',{jobId:decision.jobId});
    }catch(error){
      const message=String(error);
      autopilotState={
        ...clearPending(autopilotState),
        phase:'STOPPED',
        uncertainJobId:decision.jobId,
        updatedAt:new Date().toISOString(),
      };
      persistAutopilotState();
      log('AUTO_CONTINUE_FAILED_CLOSED',{jobId:decision.jobId,error:message,ambiguous:message.includes('DELIVERED')});
    }
    persistEvidence();
  }finally{autopilotTicking=false;}
}

async function recoverWorker(workerId:WorkerId){
  const state=states.get(workerId)!;
  if(!state.enabled||state.blocked||state.manualCloseSuppressed||paused||killed||!startupReady||recoveryInFlight.has(workerId)||!workerNeeded(workerId))return;
  if(recentHeartbeat(workerId))return;
  if(state.lastHeartbeat&&state.windowState!=='CLOSED'){
    if(!workerHasActiveJob(workerId)){
      if(state.status!=='RECOVERY_AMBIGUOUS_WINDOW'){
        state.status='RECOVERY_AMBIGUOUS_WINDOW';
        state.lastError=`RECOVERY_AMBIGUOUS_WINDOW:${workerId}`;
        log('RECOVERY_AMBIGUOUS_WINDOW_FAIL_CLOSED',{workerId,lastWindowId:state.lastWindowId??null});
        persistEvidence();
      }
      return;
    }
    state.windowState='CLOSED';
    log('RECOVERY_ACTIVE_STALE',{workerId,lastWindowId:state.lastWindowId??null});
  }
  const attempts=recoveryAttempts.get(workerId)??0;
  if(attempts>=config.recovery.maxReopenAttempts){
    if(state.status!=='RECOVERY_EXHAUSTED'){
      state.status='RECOVERY_EXHAUSTED';
      state.lastError=`RECOVERY_EXHAUSTED:${workerId}`;
      log('RECOVERY_EXHAUSTED',{workerId,attempts});
      persistEvidence();
    }
    return;
  }
  recoveryInFlight.add(workerId);
  recoveryAttempts.set(workerId,attempts+1);
  state.status='RECOVERING';
  if(workerId==='NV02')setAutopilotPhase('RECOVERING');
  log('RECOVERY_REOPEN_SCHEDULED',{workerId,attempt:attempts+1});
  try{
    await delay(config.recovery.reopenBackoffMs);
    await startWorker(workerId);
    log('RECOVERY_REOPEN_OK',{workerId,attempt:attempts+1});
  }catch(error){
    state.status=String(error).includes('RECOVERY_AMBIGUOUS_WINDOW')?'RECOVERY_AMBIGUOUS_WINDOW':'RECOVERY_ERROR';
    state.lastError=String(error);
    log('RECOVERY_REOPEN_FAILED',{workerId,attempt:attempts+1,error:String(error)});
  }finally{
    recoveryInFlight.delete(workerId);
    persistEvidence();
  }
}
async function recoveryTick(){
  if(recoveryTicking||paused||killed||!startupReady)return;
  recoveryTicking=true;
  try{
    for(const id of WORKER_IDS){
      const state=states.get(id)!;
      if(state.enabled&&!state.blocked&&workerNeeded(id)&&!recentHeartbeat(id))void recoverWorker(id);
    }
  }finally{recoveryTicking=false;}
}
async function waitForStartupRuntime(){
  const url=config.recovery.startupReadyUrl;
  if(!url)return true;
  const deadline=Date.now()+config.recovery.startupReadyTimeoutMs;
  while(Date.now()<deadline){
    try{const response=await fetch(url,{signal:AbortSignal.timeout(3000)});if(response.ok)return true;}catch{}
    await delay(3000);
  }
  return false;
}
async function waitForStartupAttach(workerId:WorkerId){
  const deadline=Date.now()+config.recovery.startupAttachGraceMs;
  while(Date.now()<deadline){if(recentHeartbeat(workerId))return true;await delay(1000);}
  return false;
}
async function startupRecovery(){
  startupReady=await waitForStartupRuntime();
  if(!startupReady){
    log('STARTUP_RUNTIME_WAIT_TIMEOUT',{url:config.recovery.startupReadyUrl??null,timeoutMs:config.recovery.startupReadyTimeoutMs});
    persistEvidence();
    return;
  }
  log('STARTUP_RUNTIME_READY',{url:config.recovery.startupReadyUrl??null,interactiveSession:isInteractiveDesktopSession(),sessionName:process.env.SESSIONNAME??null});
  if(paused){
    log('STARTUP_OWNER_INTERACTION_READ_ONLY');
    persistEvidence();
    return;
  }
  const needed=new Set<WorkerId>(['NV02',...snapshotRequiredWorkers()]);
  for(const id of WORKER_IDS){
    if(!needed.has(id)||!states.get(id)?.enabled||states.get(id)?.blocked||states.get(id)?.manualCloseSuppressed)continue;
    try{
      const attached=await waitForStartupAttach(id);
      if(attached){await layoutWorker(id);states.get(id)!.status='READY';log('STARTUP_WORKER_REATTACHED',{workerId:id});}
      else await startWorker(id);
    }catch(error){log('STARTUP_WORKER_RECOVERY_FAILED',{workerId:id,error:String(error)});}
  }
  persistEvidence();
  void autopilotTick();
}

async function handleApi(req:IncomingMessage,res:ServerResponse,url:URL):Promise<boolean>{
  if(req.method==='OPTIONS'){json(res,204,{});return true;}
  if(url.pathname==='/api/state'&&req.method==='GET'){
    json(res,200,{
      paused,killed,startAllRunning,startupReady,
      ownerInteractionMode:paused?'READ_ONLY':'AUTOMATION',
      interactiveSession:isInteractiveDesktopSession(),
      sessionName:process.env.SESSIONNAME??null,
      autopilot:autopilotState,
      recovery:{attempts:Object.fromEntries(recoveryAttempts),maxReopenAttempts:config.recovery.maxReopenAttempts},
      evidencePath:runtimeEvidencePath,
      workers:[...states.values()],
    });
    return true;
  }
  if(url.pathname==='/api/evidence'&&req.method==='GET'){json(res,200,persistEvidence());return true;}
  if(url.pathname==='/api/autopilot/state'&&req.method==='GET'){json(res,200,{state:autopilotState,snapshot:latestSnapshot??null});return true;}
  if(url.pathname==='/api/autopilot/snapshot'&&req.method==='POST'){
    try{
      const snapshot=validateExternalSnapshot(await body(req));
      latestSnapshot=snapshot;
      atomicJson(autopilotSnapshotPath,snapshot);
      log('AUTOPILOT_SNAPSHOT_ACCEPTED',{source:snapshot.source,revision:snapshot.revision,nextJobId:snapshot.nextJob?.jobId??null});
      persistEvidence();
      void autopilotTick();
      json(res,202,{ok:true});
    }catch(error){json(res,400,{ok:false,error:String(error)});}
    return true;
  }
  if(url.pathname==='/api/heartbeat'&&req.method==='POST'){
    const data=await body(req);
    const workerId=data.workerId as WorkerId;
    if(!getWorker(workerId)){json(res,400,{ok:false,error:'UNKNOWN_WORKER'});return true;}
    const state=states.get(workerId)!;
    const hb:Heartbeat={...(data as unknown as Heartbeat),workerId,at:new Date().toISOString()};
    state.lastHeartbeat=hb;
    state.windowState='OPEN';
    state.windowEventAt=hb.at;
    state.lastWindowId=hb.windowId;
    if(hb.securityBlock&&hb.securityBlock.startsWith('BLOCKED_')){
      state.blocked=true;state.status='BLOCKED';state.lastError=hb.securityBlock;
      if(workerId==='NV02')stopAutopilot(hb.securityBlock);
      log('HEARTBEAT_SECURITY_STOP',{workerId,status:hb.securityBlock});
    }else if(!state.blocked){state.lastError=undefined;}
    recoveryAttempts.set(workerId,0);
    if(!state.enabled){state.status='DISABLED';json(res,200,{ok:true,enabled:false});return true;}
    if(['IDLE','STARTING','RECOVERING','RECOVERY_ERROR','RECOVERY_AMBIGUOUS_WINDOW','RECOVERY_EXHAUSTED','WINDOW_CLOSED_IDLE','WINDOW_CLOSED_ACTIVE'].includes(state.status))state.status='ONLINE';
    json(res,200,{ok:true,enabled:true});
    return true;
  }
  if(url.pathname==='/api/window-event'&&req.method==='POST'){
    const data=await body(req);
    const workerId=data.workerId as WorkerId;
    const state=states.get(workerId);
    if(!state){json(res,400,{ok:false,error:'UNKNOWN_WORKER'});return true;}
    if(data.event!=='CLOSED'){json(res,400,{ok:false,error:'UNSUPPORTED_WINDOW_EVENT'});return true;}
    const windowId=Number(data.windowId);
    if(state.lastWindowId&&Number.isFinite(windowId)&&state.lastWindowId!==windowId){json(res,202,{ok:true,ignored:'STALE_WINDOW_EVENT'});return true;}
    const recoveryEligible=!paused&&!state.manualCloseSuppressed&&workerHasActiveJob(workerId);
    state.windowState='CLOSED';
    state.windowEventAt=new Date().toISOString();
    state.manualCloseSuppressed=!recoveryEligible;
    state.status=recoveryEligible?'WINDOW_CLOSED_ACTIVE':'WINDOW_CLOSED_IDLE';
    state.lastError=undefined;
    recoveryAttempts.set(workerId,0);
    log('WORKER_WINDOW_CLOSED',{workerId,windowId:Number.isFinite(windowId)?windowId:null,recoveryEligible,ownerInteractionMode:paused?'READ_ONLY':'AUTOMATION'});
    persistEvidence();
    if(recoveryEligible)void recoveryTick();
    json(res,202,{ok:true,recoveryEligible});
    return true;
  }
  if(url.pathname.startsWith('/api/commands/')&&req.method==='GET'){
    const workerId=decodeURIComponent(url.pathname.split('/').pop()!) as WorkerId;
    if(!getWorker(workerId)){json(res,404,{ok:false});return true;}
    if(!states.get(workerId)!.enabled){json(res,200,{command:null,disabled:true,error:`WORKER_DISABLED:${workerId}`});return true;}
    const command=commandQueues.get(workerId)!.shift()??null;
    if(command){const waiter=waiters.get(command.id);if(waiter)waiter.delivered=true;}
    json(res,200,{command});
    return true;
  }
  if(url.pathname==='/api/result'&&req.method==='POST'){
    const data=await body(req);
    const commandId=String(data.commandId??'');
    const workerId=data.workerId as WorkerId;
    const waiter=waiters.get(commandId);
    if(String(data.status??'').startsWith('BLOCKED')){
      const state=states.get(workerId);
      if(state){state.blocked=true;if(state.enabled)state.status='BLOCKED';state.lastError=String(data.status);}
      if(workerId==='NV02')stopAutopilot(String(data.status));
      log('SECURITY_STOP',{workerId,status:data.status});
    }
    if(waiter){
      clearTimeout(waiter.timer);
      waiters.delete(commandId);
      if(data.ok===false)waiter.reject(new Error(String(data.status??data.error??'COMMAND_FAILED')));
      else waiter.resolve(data);
    }
    log('COMMAND_RESULT',{workerId,commandId,ok:data.ok,status:data.status});
    persistEvidence();
    json(res,200,{ok:true});
    return true;
  }
  if(url.pathname==='/api/start-all'&&req.method==='POST'){
    if(paused){json(res,409,{ok:false,error:'OWNER_INTERACTION_READ_ONLY'});return true;}
    if(startAllRunning){json(res,409,{ok:false,error:'START_ALL_ALREADY_RUNNING'});return true;}
    startAllRunning=true;
    void(async()=>{
      try{
        for(const worker of config.workers){
          if(!states.get(worker.id)!.enabled){log('START_ALL_SKIPPED_DISABLED',{workerId:worker.id});continue;}
          await startWorker(worker.id);
        }
      }catch(error){log('START_ALL_FAILED',{error:String(error)});}
      finally{startAllRunning=false;persistEvidence();}
    })();
    json(res,202,{ok:true});
    return true;
  }
  if(url.pathname==='/api/pause'&&req.method==='POST'){setOwnerInteractionReadOnly(true);persistEvidence();json(res,200,{ok:true,ownerInteractionMode:'READ_ONLY'});return true;}
  if(url.pathname==='/api/resume'&&req.method==='POST'){setOwnerInteractionReadOnly(false);killed=false;persistEvidence();void recoveryTick();void autopilotTick();json(res,200,{ok:true,ownerInteractionMode:'AUTOMATION'});return true;}
  if(url.pathname==='/api/kill'&&req.method==='POST'){
    killed=true;setOwnerInteractionReadOnly(true);
    for(const queue of commandQueues.values())queue.splice(0);
    log('KILL_SWITCH');persistEvidence();json(res,200,{ok:true});return true;
  }
  const match=url.pathname.match(/^\/api\/workers\/(NV03|NV04|NV02)\/(start|focus|layout|dispatch|close|unblock|enable|disable)$/);
  if(match&&req.method==='POST'){
    const workerId=match[1] as WorkerId;
    const action=match[2];
    try{
      if(action==='enable')setWorkerEnabled(workerId,true);
      else if(action==='disable')setWorkerEnabled(workerId,false);
      else{
        assertWorkerEnabled(workerId);
        if(action==='start')await startWorker(workerId);
        else if(action==='focus')await uiQueue.enqueue(()=>sendCommand(workerId,'FOCUS'));
        else if(action==='layout')await layoutWorker(workerId);
        else if(action==='close'){
          const state=states.get(workerId)!;
          state.manualCloseSuppressed=true;
          state.status='MANUAL_CLOSE_REQUESTED';
          await uiQueue.enqueue(()=>sendCommand(workerId,'CLOSE_WINDOW'));
        }else if(action==='unblock'){
          const state=states.get(workerId)!;
          state.blocked=false;
          state.status=recentHeartbeat(workerId)?'READY':'IDLE';
          state.lastError=undefined;
          recoveryAttempts.set(workerId,0);
        }else if(action==='dispatch'){
          const data=await body(req);
          if(typeof data.text!=='string')throw new Error('DISPATCH_TEXT_MUST_BE_STRING');
          await dispatch(workerId,data.text,data.navigate!==false);
        }
      }
      persistEvidence();
      json(res,200,{ok:true,enabled:states.get(workerId)!.enabled});
    }catch(error){json(res,409,{ok:false,error:String(error)});}
    return true;
  }
  return false;
}

const dashboardPath=resolve(process.cwd(),'apps/chrome-controller/public/index.html');
const dashboard=readFileSync(dashboardPath,'utf8');
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url??'/',`http://${config.host}:${config.port}`);
    if(await handleApi(req,res,url))return;
    if(url.pathname==='/'||url.pathname==='/index.html'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      res.end(dashboard);
      return;
    }
    json(res,404,{ok:false,error:'NOT_FOUND'});
  }catch(error){
    log('HTTP_ERROR',{error:String(error)});
    json(res,500,{ok:false,error:String(error)});
  }
});
server.listen(config.port,config.host,()=>{
  log('CONTROLLER_READY',{
    host:config.host,
    port:config.port,
    logPath,
    workerOrder:WORKER_IDS,
    fixedTrigger:AUTO_CONTINUE,
    ownerInteractionMode:paused?'READ_ONLY':'AUTOMATION',
    interactiveSession:isInteractiveDesktopSession(),
    sessionName:process.env.SESSIONNAME??null,
  });
  persistEvidence();
  void startupRecovery();
});
setInterval(()=>void autopilotTick(),config.autopilot.pollIntervalMs).unref();
setInterval(()=>void recoveryTick(),config.recovery.checkIntervalMs).unref();
