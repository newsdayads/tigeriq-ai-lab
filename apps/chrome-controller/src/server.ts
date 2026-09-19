import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  loadConfig,
  computePlacements,
  isWorkerEnabled,
  isInteractiveDesktopSession,
  reconcileWorkerUiStatus,
  WORKER_IDS,
  type ControllerConfig,
  type WorkerId,
  type WorkArea,
} from './model.js';
import { delay, SerialQueue } from './serial-queue.js';
import {
  AUTO_CONTINUE,
  classifyAutoContinueDispatchFailure,
  canResetOrphanUnpersistedDispatch,
  decideAutoContinue,
  freshAutopilotState,
  selectFreshCompletionEvidence,
  sourceStillOffersPendingJob,
  validateExternalSnapshot,
  type DurableAutopilotState,
  type ExternalAutopilotSnapshot,
} from './autopilot.js';
import { atomicWriteJsonWithRetry, buildRuntimeEvidence } from './runtime-evidence.js';
import { DurableDispatchLeaseStore } from './dispatch-lease.js';
import { BrowserMutationLeaseStore } from './browser-mutation-lease.js';
import { heartbeatStopReason } from './security-gate.js';
import { DurableUiJobLedger, isTerminalUiJobStage, isUiJobStage, reconcileUiJobStage, type UiJobMetadata } from './job-ledger.js';
import type { WorkerPresence } from './worker-presence.js';
import { persistWorkerSafetyStateOrFailClosed, restoreWorkerSafetyState, workerStartGate, type WorkerSafetySnapshot } from './worker-safety-state.js';

type Command = { id:string; workerId:WorkerId; action:string; payload?:Record<string,unknown>; createdAt:string };
type Heartbeat = { workerId:WorkerId; url?:string; windowId?:number; tabId?:number; state?:string; uiReady?:boolean; authRequired?:boolean; reauthRequired?:boolean; captchaRequired?:boolean; rateLimited?:boolean; rateLimitCode?:number|string; uiBusy?:boolean|null; uiPhase?:'WORKING'|'READY'|'STALLED'|'BLOCKED'|string; composerReady?:boolean; sendReady?:boolean; stopVisible?:boolean; scrollToBottomVisible?:boolean; securityBlock?:string|null; display?:{workArea?:WorkArea}; at:string };
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
const utilityPausedWorkers = new Set<WorkerId>();
const recoveryAttempts = new Map<WorkerId,number>(WORKER_IDS.map((id) => [id,0]));
const recoveryInFlight = new Set<WorkerId>();
const plannedRefreshWorkers = new Set<WorkerId>();
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
const dispatchLeasePath=resolve(config.logDir,'autopilot-dispatch-lease.json');
const browserMutationLeasePath=resolve(config.logDir,'browser-mutation-leases.json');
const uiJobLedgerPath=resolve(config.logDir,'ui-job-ledger.json');
const workerSafetyStatePath=resolve(config.logDir,'worker-safety-state.json');
const controllerInstanceId=randomUUID();
const dispatchLease=new DurableDispatchLeaseStore(dispatchLeasePath,controllerInstanceId,config.autopilot.dispatchLeaseTtlMs??300000);
const browserMutationLeases=new BrowserMutationLeaseStore(browserMutationLeasePath);
const uiJobLedger=new DurableUiJobLedger(uiJobLedgerPath);
const pageMutationActions=new Set(['NAVIGATE','DISPATCH','ARCHIVE_CHAT','CLOSE_WINDOW']);

function log(event:string,data:Record<string,unknown>={}){
  const line=JSON.stringify({ts:new Date().toISOString(),event,...data});
  appendFileSync(logPath,`${line}\n`,'utf8');
  console.log(line);
}
function fsErrorCode(error:unknown){return error instanceof Error&&'code' in error?String((error as NodeJS.ErrnoException).code??''):'';}
function atomicJson(path:string,value:unknown){atomicWriteJsonWithRetry(path,value);}
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
function applyWorkerSafetySnapshot(snapshot:WorkerSafetySnapshot){
  utilityPausedWorkers.clear();
  for(const id of WORKER_IDS)states.get(id)!.manualCloseSuppressed=false;
  for(const id of snapshot.pausedWorkers)utilityPausedWorkers.add(id);
  for(const id of snapshot.manualCloseSuppressedWorkers)states.get(id)!.manualCloseSuppressed=true;
  for(const id of WORKER_IDS){
    if(utilityPausedWorkers.has(id)||states.get(id)!.manualCloseSuppressed===true)states.get(id)!.status='PAUSED';
  }
}
const restoredWorkerSafety=restoreWorkerSafetyState(workerSafetyStatePath);
applyWorkerSafetySnapshot(restoredWorkerSafety.state);
if(restoredWorkerSafety.failClosed)log('WORKER_SAFETY_STATE_FAIL_CLOSED',{error:String(restoredWorkerSafety.error)});
function persistAutopilotState(){atomicJson(autopilotStatePath,autopilotState);}
function persistInteractionState(){atomicJson(interactionStatePath,{readOnly:paused,updatedAt:new Date().toISOString()});}
function persistWorkerSafetyState(){
  const intended:WorkerSafetySnapshot={
    pausedWorkers:[...utilityPausedWorkers],
    manualCloseSuppressedWorkers:WORKER_IDS.filter((id)=>states.get(id)?.manualCloseSuppressed===true),
  };
  const persisted=persistWorkerSafetyStateOrFailClosed(workerSafetyStatePath,intended);
  if(!persisted.failClosed)return;
  applyWorkerSafetySnapshot(persisted.state);
  log('WORKER_SAFETY_STATE_PERSIST_FAIL_CLOSED',{error:String(persisted.error)});
  throw persisted.error instanceof Error?persisted.error:new Error('WORKER_SAFETY_STATE_PERSIST_FAILED');
}
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
function heartbeatFresh(state:WorkerState|undefined){return Boolean(state?.lastHeartbeat&&state.windowState!=='CLOSED'&&Date.now()-Date.parse(state.lastHeartbeat.at)<config.recovery.heartbeatStaleMs);}
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
    persistWorkerSafetyState();
    log('WORKER_DISABLED',{workerId:id});
    return;
  }
  state.manualCloseSuppressed=false;
  persistWorkerSafetyState();
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
    jobs:uiJobLedger.snapshot(),
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
function persistEvidence(){
  const value=evidence();
  try{atomicJson(runtimeEvidencePath,value);}
  catch(error){log('PERSIST_EVIDENCE_FAILED',{path:runtimeEvidencePath,error:String(error),code:fsErrorCode(error)});}
  return value;
}

async function brokerWorkerPresence(workerId:WorkerId):Promise<WorkerPresence>{
  const url=config.recovery.launchBrokerUrl;
  if(!url){log('BROKER_PRESENCE_UNAVAILABLE',{workerId,reason:'CHROME_LAUNCH_BROKER_REQUIRED'});return 'AMBIGUOUS';}
  try{
    const response=await fetch(`${url}/api/presence/${workerId}`,{signal:AbortSignal.timeout(config.recovery.launchBrokerTimeoutMs??5000)});
    if(!response.ok){log('BROKER_PRESENCE_UNAVAILABLE',{workerId,status:response.status});return 'AMBIGUOUS';}
    const value=await response.json() as {presence?:WorkerPresence};
    if(!['RUNNING','ABSENT','AMBIGUOUS'].includes(String(value.presence))){log('BROKER_PRESENCE_INVALID',{workerId,value:value.presence??null});return 'AMBIGUOUS';}
    return value.presence as WorkerPresence;
  }catch(error){
    log('BROKER_PRESENCE_UNAVAILABLE',{workerId,error:String(error)});
    return 'AMBIGUOUS';
  }
}

async function launchChrome(workerId:WorkerId){
  assertWorkerEnabled(workerId);
  if(!isInteractiveDesktopSession())throw new Error('INTERACTIVE_SESSION_REQUIRED:NO_HIDDEN_CHROME');
  const url=config.recovery.launchBrokerUrl;
  if(!url)throw new Error('CHROME_LAUNCH_BROKER_REQUIRED');
  const placement=computePlacements(config,effectiveWorkArea())[workerId];
  const response=await fetch(`${url}/api/launch`,{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({workerId,placement}),signal:AbortSignal.timeout((config.recovery.launchBrokerTimeoutMs??5000))});
  if(!response.ok)throw new Error(`CHROME_LAUNCH_BROKER_HTTP_${response.status}:${await response.text()}`);
  const state=states.get(workerId)!;
  state.status='STARTING';
  state.windowState='OPEN';
  state.windowEventAt=new Date().toISOString();
  state.manualCloseSuppressed=false;
  persistWorkerSafetyState();
  log('CHROME_LAUNCH_REQUESTED_VIA_BROKER',{workerId,placement,brokerUrl:url,controllerInstanceId});
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
  if(utilityPausedWorkers.has(workerId)&&!['FOCUS','LAYOUT'].includes(action))return Promise.reject(new Error(`UTILITY_WORKER_PAUSED:${workerId}`));
  if(state.blocked&&!['FOCUS','LAYOUT'].includes(action))return Promise.reject(new Error(`WORKER_BLOCKED:${workerId}`));
  if(pageMutationActions.has(action))browserMutationLeases.assertControllerAllowed(workerId);
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
async function startWorker(workerId:WorkerId){
  assertWorkerEnabled(workerId);
  const state=states.get(workerId)!;
  const initialGate=workerStartGate(workerId,{globalPaused:paused,utilityPaused:utilityPausedWorkers.has(workerId),manualCloseSuppressed:state.manualCloseSuppressed===true});
  if(initialGate)throw new Error(initialGate);
  await launchQueue.enqueue(async()=>{
    assertWorkerEnabled(workerId);
    const queuedGate=workerStartGate(workerId,{globalPaused:paused,utilityPaused:utilityPausedWorkers.has(workerId),manualCloseSuppressed:state.manualCloseSuppressed===true});
    if(queuedGate)throw new Error(queuedGate);
    if(!recentHeartbeat(workerId)){
      const presence=await brokerWorkerPresence(workerId);
      if(presence==='RUNNING')throw new Error(`WORKER_RUNNING_WITHOUT_HEARTBEAT:${workerId}`);
      if(presence!=='ABSENT')throw new Error(`RECOVERY_AMBIGUOUS_WINDOW:${workerId}`);
      state.windowState='CLOSED';
      await launchChrome(workerId);
    }
    await waitForHeartbeat(workerId);
    await delay(config.pacing.postReadySettlingMs);
    assertWorkerEnabled(workerId);
    if(utilityPausedWorkers.has(workerId))throw new Error(`UTILITY_WORKER_PAUSED:${workerId}`);
    await layoutWorker(workerId);
    state.status='READY';
    state.lastError=undefined;
    state.windowState='OPEN';
    state.manualCloseSuppressed=false;
    persistWorkerSafetyState();
    recoveryAttempts.set(workerId,0);
    log('WORKER_READY',{workerId});
    persistEvidence();
  });
}

async function dispatch(
  workerId:WorkerId,
  text:string,
  navigate:boolean,
  source:'MANUAL'|'AUTO_CONTINUE'='MANUAL',
  metadata:UiJobMetadata={},
){
  assertWorkerEnabled(workerId);
  if(!text.trim())throw new Error('DISPATCH_TEXT_REQUIRED');
  const worker=getWorker(workerId)!;
  browserMutationLeases.assertControllerAllowed(workerId);
  const requestedJobId=String(metadata.jobId??'').trim();
  const prior=requestedJobId?uiJobLedger.get(workerId,requestedJobId):undefined;
  const retryKnownNotDelivered=source==='AUTO_CONTINUE'&&prior?.stage==='ERROR'&&classifyAutoContinueDispatchFailure(new Error(prior.blocker??''),false)==='SAFE_RETRY';
  const job=retryKnownNotDelivered
    ? uiJobLedger.retryError(workerId,requestedJobId,{...metadata,source:metadata.source??source})
    : uiJobLedger.create(workerId,{...metadata,source:metadata.source??source});
  if(retryKnownNotDelivered)log('UI_JOB_ERROR_REOPENED_SAFE_RETRY',{workerId,jobId:job.jobId});
  uiJobLedger.transition(workerId,job.jobId,'DISPATCHING',{nextAction:'Deliver to worker UI'});
  states.get(workerId)!.status=source==='AUTO_CONTINUE'?'AUTOPILOT_DISPATCHING':'DISPATCHING';
  persistEvidence();
  return uiQueue.enqueue(async()=>{
    try{
      assertWorkerEnabled(workerId);
      if(navigate)await runWithRetry(`navigate:${workerId}`,()=>sendCommand(workerId,'NAVIGATE',{url:worker.homeUrl}));
      const result=await sendCommand(workerId,'DISPATCH',{text});
      states.get(workerId)!.status='SUBMITTED';
      states.get(workerId)!.lastError=undefined;
      uiJobLedger.transition(workerId,job.jobId,'SUBMITTED',{nextAction:'Wait for real UI activity'});
      log(source==='AUTO_CONTINUE'?'AUTO_CONTINUE_SUBMITTED':'WORK_ORDER_SUBMITTED',{
        workerId,
        jobId:job.jobId,
        issueRef:job.issueRef,
        trigger:source==='AUTO_CONTINUE'?AUTO_CONTINUE:undefined,
        chars:text.length,
      });
      persistEvidence();
      return result;
    }catch(error){
      const state=states.get(workerId)!;
      if(state.enabled&&!state.blocked)state.status='ERROR';
      state.lastError=String(error);
      uiJobLedger.transition(workerId,job.jobId,'ERROR',{blocker:String(error),nextAction:'Root-cause and safe retry'});
      persistEvidence();
      throw error;
    }
  });
}

function snapshotRequiredWorkers():WorkerId[]{return latestSnapshot?.requiredWorkers?.filter((id)=>states.get(id)?.enabled)??[];}
function workerHasActiveJob(id:WorkerId){
  if(uiJobLedger.active(id))return true;
  if(id==='NV02'){
    if(autopilotState.pendingJobId||autopilotState.uncertainJobId)return true;
    const previous=latestSnapshot?.previousJob;
    return Boolean(previous&&previous.workerId==='NV02'&&previous.jobId===autopilotState.lastDispatchedJobId&&['QUEUED','READY','RUNNING'].includes(previous.status));
  }
  return snapshotRequiredWorkers().includes(id);
}
function workerNeeded(id:WorkerId){
  const state=states.get(id);
  if(!state?.enabled||state.manualCloseSuppressed||utilityPausedWorkers.has(id))return false;
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
function reconcileCompletedUiJobFromSnapshot(){
  const previous=latestSnapshot?.previousJob;
  if(!previous||previous.workerId!=='NV02'||previous.status!=='DONE')return false;
  const ext=selectFreshCompletionEvidence(previous,autopilotState,Date.parse(latestSnapshot!.observedAt));
  if(!ext)return false;
  if(autopilotState.lastCompletedJobId!==previous.jobId){
    autopilotState={...autopilotState,lastCompletedJobId:previous.jobId,lastEvidenceRef:ext.ref,lastCompletedEvidenceRevision:ext.completionRevision,updatedAt:new Date().toISOString()};
    persistAutopilotState();
    log('COMPLETION_WATCHER_DONE_EVIDENCE',{jobId:previous.jobId,evidenceRef:ext.ref,evidenceRevision:ext.completionRevision,source:ext.source});
  }
  let active=uiJobLedger.active('NV02');
  if(active?.jobId!==previous.jobId)return true;
  if(active.stage==='SUBMITTED'||active.stage==='WORKING'){
    uiJobLedger.transition('NV02',previous.jobId,'WAITING_EVIDENCE',{evidenceRef:ext.ref,nextAction:'Verify authoritative completion'});
    active=uiJobLedger.active('NV02');
  }
  if(active?.jobId===previous.jobId&&active.stage==='WAITING_EVIDENCE'){
    uiJobLedger.transition('NV02',previous.jobId,'VERIFY',{evidenceRef:ext.ref,nextAction:'Verify authoritative completion'});
    uiJobLedger.transition('NV02',previous.jobId,'DONE',{evidenceRef:ext.ref,result:`Authoritative external completion verified for ${previous.jobId}`});
    log('UI_JOB_EXTERNAL_COMPLETION_RECONCILED',{jobId:previous.jobId,evidenceRef:ext.ref});
  }
  return true;
}
async function autopilotTick(){
  if(autopilotTicking||!config.autopilot.enabled||paused||killed)return;
  autopilotTicking=true;
  try{
    if(config.autopilot.stateUrl){
      try{await fetchExternalSnapshot();}
      catch(error){log('AUTOPILOT_EXTERNAL_STATE_UNAVAILABLE',{error:String(error)});}
    }
    if(autopilotState.pendingJobId){
      const pendingJobId=autopilotState.pendingJobId;
      const leaseState=dispatchLease.read();
      const sourceWithdrawn=Boolean(latestSnapshot&&!sourceStillOffersPendingJob(latestSnapshot,pendingJobId));
      const canRetireWithdrawn=sourceWithdrawn&&!leaseState.malformed&&leaseState.lease?.jobId===pendingJobId&&leaseState.lease.state!=='COMMITTED';
      if(canRetireWithdrawn){
        const primary=states.get('NV02')!;
        if(!recentHeartbeat('NV02')||primary.lastHeartbeat?.uiBusy!==false){
          stopAutopilot(`PENDING_SOURCE_WITHDRAWN_UI_NOT_IDLE:${pendingJobId}`);persistEvidence();return;
        }
        const localJob=uiJobLedger.get('NV02',pendingJobId);
        if(localJob&&!isTerminalUiJobStage(localJob.stage))uiJobLedger.transition('NV02',pendingJobId,'BLOCKED',{nextAction:null,blocker:'SOURCE_JOB_NO_LONGER_EXECUTABLE',result:'Source withdrew/cancelled work before a committed dispatch'});
        const retired=dispatchLease.retireNoLongerExecutable(pendingJobId,Date.now());
        autopilotState={...clearPending(autopilotState),phase:'IDLE',uncertainJobId:undefined,dispatchFailureClass:undefined,retryAt:undefined,updatedAt:new Date().toISOString()};
        persistAutopilotState();
        log('AUTO_CONTINUE_PENDING_SOURCE_WITHDRAWN',{jobId:pendingJobId,priorLeaseState:leaseState.lease?.state??null,retiredLeaseId:retired.leaseId});
        persistEvidence();
      }else{
        const reconciliation=dispatchLease.reconcilePending(pendingJobId);
        if(reconciliation.kind==='WAIT'){
          setAutopilotPhase('BUSY');log('AUTO_CONTINUE_PENDING_LEASE_WAIT',{jobId:pendingJobId,leaseId:reconciliation.lease.leaseId,expiresAt:reconciliation.lease.expiresAt});persistEvidence();return;
        }
        if(reconciliation.kind==='UNCERTAIN'){
          autopilotState={...clearPending(autopilotState),uncertainJobId:pendingJobId,updatedAt:new Date().toISOString()};
          stopAutopilot(reconciliation.reason);persistAutopilotState();log('AUTO_CONTINUE_PENDING_RECONCILE_UNCERTAIN',{jobId:pendingJobId,reason:reconciliation.reason});persistEvidence();return;
        }
        if(reconciliation.kind==='COMMITTED'){
          autopilotState={...clearPending(autopilotState),phase:'BUSY',lastDispatchedJobId:pendingJobId,lastDispatchedAt:reconciliation.lease.dispatchedAt,uncertainJobId:undefined,updatedAt:new Date().toISOString()};
          persistAutopilotState();log('AUTO_CONTINUE_PENDING_RECONCILED_COMMITTED',{jobId:pendingJobId,leaseId:reconciliation.lease.leaseId});
        }else{
          autopilotState={...clearPending(autopilotState),phase:'IDLE',updatedAt:new Date().toISOString()};
          persistAutopilotState();log('AUTO_CONTINUE_PENDING_RECONCILED_SAFE_RETRY',{jobId:pendingJobId,leaseId:reconciliation.lease.leaseId});
        }
      }
    }
    if(!latestSnapshot){setAutopilotPhase('IDLE');persistEvidence();return;}
    reconcileCompletedUiJobFromSnapshot();
    if(autopilotState.uncertainJobId){
      const uncertainJobId=autopilotState.uncertainJobId;
      const uncertain=uiJobLedger.get('NV02',uncertainJobId);
      const leaseState=dispatchLease.read();
      const knownNotDelivered=uncertain?.stage==='ERROR'&&classifyAutoContinueDispatchFailure(new Error(uncertain.blocker??''),false)==='SAFE_RETRY';
      const orphanBeforeLedgerCommit=canResetOrphanUnpersistedDispatch(uncertainJobId,Boolean(uncertain),leaseState.lease,Date.now());
      if(knownNotDelivered||orphanBeforeLedgerCommit){
        dispatchLease.resetKnownNotDelivered(uncertainJobId,Date.now(),0);
        autopilotState={...clearPending(autopilotState),phase:'IDLE',uncertainJobId:undefined,dispatchFailureClass:'SAFE_RETRY',retryAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        persistAutopilotState();
        log(orphanBeforeLedgerCommit?'AUTO_CONTINUE_ORPHAN_PRE_DISPATCH_RECOVERED':'AUTO_CONTINUE_UNCERTAIN_RECLASSIFIED_SAFE_RETRY',{jobId:uncertainJobId,priorBlocker:uncertain?.blocker??null,leaseState:leaseState.lease?.state??null});
      }
    }
    const decision=decideAutoContinue(latestSnapshot,autopilotState,Date.now(),config.autopilot.maxSnapshotAgeMs);
    if(decision.kind==='IDLE'){lastAutopilotStopReason='';setAutopilotPhase('IDLE');persistEvidence();return;}
    if(decision.kind==='BUSY'||decision.kind==='DUPLICATE_NOOP'){lastAutopilotStopReason='';setAutopilotPhase('BUSY');persistEvidence();return;}
    if(decision.kind==='WAIT_EVIDENCE'){lastAutopilotStopReason='';setAutopilotPhase('WAIT_EVIDENCE');persistEvidence();return;}
    if(decision.kind==='STOP'){stopAutopilot(decision.reason);persistEvidence();return;}
    const primary=states.get('NV02')!;
    if(utilityPausedWorkers.has('NV02')){setAutopilotPhase('IDLE');persistEvidence();return;}
    if(!primary.enabled||primary.blocked||!startupReady){stopAutopilot(primary.blocked?'NV02_BLOCKED':'NV02_NOT_READY');persistEvidence();return;}
    if(!recentHeartbeat('NV02')){setAutopilotPhase('RECOVERING');persistEvidence();return;}
    const uiSecurity=heartbeatStopReason(primary.lastHeartbeat);
    if(uiSecurity){
      primary.blocked=true;primary.status='BLOCKED';primary.lastError=uiSecurity;
      stopAutopilot(uiSecurity);log('AUTOPILOT_SECURITY_STOP',{workerId:'NV02',status:uiSecurity});persistEvidence();return;
    }
    if(autopilotState.lastDispatchedJobId&&primary.lastHeartbeat?.uiBusy!==false){
      setAutopilotPhase('BUSY');
      log('AUTOPILOT_WAIT_UI_BUSY',{workerId:'NV02',uiBusy:primary.lastHeartbeat?.uiBusy??null,lastDispatchedJobId:autopilotState.lastDispatchedJobId});
      persistEvidence();return;
    }
    const leaseResult=dispatchLease.acquire(decision.jobId);
    if(leaseResult.kind==='BUSY'){
      setAutopilotPhase('BUSY');log('AUTO_CONTINUE_LEASE_BUSY',{jobId:decision.jobId,leaseJobId:leaseResult.lease.jobId,leaseOwnerId:leaseResult.lease.ownerId});persistEvidence();return;
    }
    if(leaseResult.kind==='UNCERTAIN'){
      stopAutopilot(leaseResult.reason);log('AUTO_CONTINUE_LEASE_UNCERTAIN',{jobId:decision.jobId,reason:leaseResult.reason});persistEvidence();return;
    }
    if(leaseResult.kind==='COMMITTED'){
      autopilotState={...clearPending(autopilotState),phase:'BUSY',lastDispatchedJobId:decision.jobId,lastDispatchedAt:leaseResult.lease.dispatchedAt??autopilotState.lastDispatchedAt,updatedAt:new Date().toISOString()};
      persistAutopilotState();log('AUTO_CONTINUE_DUPLICATE_SUPPRESSED_DURABLE',{jobId:decision.jobId,leaseId:leaseResult.lease.leaseId});persistEvidence();return;
    }
    const dispatchLeaseToken=leaseResult.lease;
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
    log('AUTO_CONTINUE_RESERVED',{jobId:decision.jobId,trigger:AUTO_CONTINUE,evidenceRef:decision.evidenceRef??null,leaseId:dispatchLeaseToken.leaseId,controllerInstanceId});
    let dispatchDelivered=false;
    try{
      dispatchLease.markDispatching(dispatchLeaseToken.leaseId,decision.jobId);
      await dispatch('NV02',decision.text,false,'AUTO_CONTINUE',{jobId:decision.jobId,issueRef:decision.issueRef,title:`Autopilot ${decision.jobId}`,source:'AUTO_CONTINUE'});
      dispatchDelivered=true;
      const committedLease=dispatchLease.markCommitted(dispatchLeaseToken.leaseId,decision.jobId);
      autopilotState={
        ...clearPending(autopilotState),
        phase:'BUSY',
        lastDispatchedJobId:decision.jobId,
        lastDispatchedAt:committedLease.dispatchedAt,
        uncertainJobId:undefined,
        dispatchFailureClass:undefined,
        retryAt:undefined,
        updatedAt:new Date().toISOString(),
      };
      persistAutopilotState();
      log('AUTO_CONTINUE_COMMITTED',{jobId:decision.jobId});
    }catch(error){
      const message=String(error);
      const failureClass=classifyAutoContinueDispatchFailure(error,dispatchDelivered);
      if(failureClass==='SAFE_RETRY'){
        try{
          dispatchLease.resetKnownNotDelivered(decision.jobId,Date.now(),0);
          autopilotState={...clearPending(autopilotState),phase:'IDLE',uncertainJobId:undefined,dispatchFailureClass:'SAFE_RETRY',retryAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
          persistAutopilotState();
          log('AUTO_CONTINUE_FAILED_SAFE_RETRY',{jobId:decision.jobId,error:message,dispatchFailureClass:'NOT_DELIVERED',retryAfterMs:0,retryAt:autopilotState.retryAt});
        }catch(retryError){
          autopilotState={...clearPending(autopilotState),phase:'STOPPED',uncertainJobId:decision.jobId,dispatchFailureClass:'UNCERTAIN',retryAt:undefined,updatedAt:new Date().toISOString()};
          persistAutopilotState();
          log('AUTO_CONTINUE_SAFE_RETRY_STATE_FAILED',{jobId:decision.jobId,error:String(retryError),originalError:message});
        }
      }else{
        autopilotState={...clearPending(autopilotState),phase:'STOPPED',uncertainJobId:decision.jobId,updatedAt:new Date().toISOString()};
        persistAutopilotState();
        log('AUTO_CONTINUE_FAILED_CLOSED',{jobId:decision.jobId,error:message,ambiguous:dispatchDelivered||message.includes('DELIVERED')});
      }
    }
    persistEvidence();
  }finally{autopilotTicking=false;}
}

async function recoverWorker(workerId:WorkerId){
  const state=states.get(workerId)!;
  if(!state.enabled||state.blocked||state.manualCloseSuppressed||utilityPausedWorkers.has(workerId)||paused||killed||!startupReady||recoveryInFlight.has(workerId)||!workerNeeded(workerId))return;
  if(recentHeartbeat(workerId))return;
  if(state.lastHeartbeat&&state.windowState!=='CLOSED'){
    const presence=await brokerWorkerPresence(workerId);
    if(presence==='ABSENT'){
      state.windowState='CLOSED';
      state.lastError=undefined;
      log('RECOVERY_CONFIRMED_ABSENT',{workerId,lastWindowId:state.lastWindowId??null});
    }else{
      const reason=presence==='RUNNING'?'RECOVERY_RUNNING_WITHOUT_HEARTBEAT':'RECOVERY_AMBIGUOUS_WINDOW';
      if(state.status!==reason||state.lastError!==`${reason}:${workerId}`){
        state.status=reason;
        state.lastError=`${reason}:${workerId}`;
        log('RECOVERY_PRESENCE_FAIL_CLOSED',{workerId,presence,lastWindowId:state.lastWindowId??null});
        persistEvidence();
      }
      return;
    }
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
      utilityPausedWorkers:[...utilityPausedWorkers],
      recovery:{attempts:Object.fromEntries(recoveryAttempts),maxReopenAttempts:config.recovery.maxReopenAttempts},
      evidencePath:runtimeEvidencePath,
      browserMutationLeases:browserMutationLeases.snapshot(),
      jobs:uiJobLedger.snapshot(),
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
  if(url.pathname==='/api/autopilot/continue-now'&&req.method==='POST'){
    try{
      if(paused)throw new Error('OWNER_INTERACTION_READ_ONLY');
      if(killed)throw new Error('CONTROLLER_KILLED');
      await fetchExternalSnapshot();
      reconcileCompletedUiJobFromSnapshot();
      if(autopilotState.uncertainJobId){
        const uncertain=autopilotState.uncertainJobId;
        const existing=uiJobLedger.get('NV02',uncertain);
        const active=uiJobLedger.active('NV02');
        const worker=states.get('NV02')!;
        const leaseState=dispatchLease.read();
        if(existing)throw new Error(`AUTOPILOT_UNCERTAIN_POSSIBLY_DELIVERED:${uncertain}`);
        if(active)throw new Error(`AUTOPILOT_ACTIVE_JOB:${active.jobId}`);
        if(worker.lastHeartbeat?.uiBusy!==false)throw new Error('AUTOPILOT_UI_BUSY_OR_UNKNOWN');
        if(!leaseState.lease||leaseState.lease.jobId!==uncertain||leaseState.lease.state!=='DISPATCHING')
          throw new Error(`AUTOPILOT_UNCERTAIN_LEASE_NOT_PROVABLY_NOT_DELIVERED:${uncertain}`);
        dispatchLease.resetKnownNotDelivered(uncertain,Date.now(),0);
        const {uncertainJobId:_uncertain,...rest}=autopilotState;
        autopilotState={...rest,phase:'IDLE',updatedAt:new Date().toISOString()};
        persistAutopilotState();
        log('AUTOPILOT_MANUAL_KNOWN_NONDELIVERY_RESET',{jobId:uncertain});
      }
      persistEvidence();
      void autopilotTick();
      json(res,202,{ok:true,mode:'RECONCILE_AND_CONTINUE'});
    }catch(error){json(res,409,{ok:false,error:String(error)});}
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
    const hbStop=heartbeatStopReason(hb);
    if(hbStop){
      state.blocked=true;state.status='BLOCKED';state.lastError=hbStop;
      const activeJob=uiJobLedger.active(workerId);
      if(activeJob)uiJobLedger.transition(workerId,activeJob.jobId,'BLOCKED',{blocker:hbStop,nextAction:'Resolve security blocker'});
      if(workerId==='NV02')stopAutopilot(hbStop);
      log('HEARTBEAT_SECURITY_STOP',{workerId,status:hbStop});
    }else if(utilityPausedWorkers.has(workerId)){
      state.status='PAUSED';state.lastError=undefined;
    }else if(!state.blocked){
      state.lastError=undefined;
      const beforeStatus=state.status;
      const uiPhase=String(hb.uiPhase??'').toUpperCase();
      state.status=['WORKING','READY','STALLED'].includes(uiPhase)?uiPhase:reconcileWorkerUiStatus(state.status,hb.uiBusy);
      if(state.status!==beforeStatus)log('WORKER_UI_STATUS_RECONCILED',{workerId,from:beforeStatus,to:state.status,uiBusy:hb.uiBusy,uiPhase:hb.uiPhase??null});
      const activeJob=uiJobLedger.active(workerId);
      if(activeJob){
        const reconciledStage=reconcileUiJobStage(activeJob.stage,hb.uiBusy);
        if(reconciledStage){
          uiJobLedger.transition(workerId,activeJob.jobId,reconciledStage,{
            nextAction:reconciledStage==='WORKING'?'Continue current work':'Attach authoritative evidence',
          });
          log('UI_JOB_STAGE_RECONCILED',{workerId,jobId:activeJob.jobId,from:activeJob.stage,to:reconciledStage,uiBusy:hb.uiBusy});
        }
      }
    }
    recoveryAttempts.set(workerId,0);
    if(!state.enabled){state.status='DISABLED';json(res,200,{ok:true,enabled:false});return true;}
    if(!utilityPausedWorkers.has(workerId)&&['IDLE','STARTING','RECOVERING','RECOVERY_ERROR','RECOVERY_AMBIGUOUS_WINDOW','RECOVERY_RUNNING_WITHOUT_HEARTBEAT','RECOVERY_EXHAUSTED','WINDOW_CLOSED_IDLE','WINDOW_CLOSED_ACTIVE'].includes(state.status))state.status='ONLINE';
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
    const plannedRefresh=plannedRefreshWorkers.has(workerId);
    const recoveryEligible=!paused&&!utilityPausedWorkers.has(workerId)&&!state.manualCloseSuppressed&&(plannedRefresh||workerHasActiveJob(workerId));
    if(plannedRefresh)plannedRefreshWorkers.delete(workerId);
    state.windowState='CLOSED';
    state.windowEventAt=new Date().toISOString();
    state.manualCloseSuppressed=!recoveryEligible;
    persistWorkerSafetyState();
    state.status=recoveryEligible?'WINDOW_CLOSED_ACTIVE':'WINDOW_CLOSED_IDLE';
    state.lastError=undefined;
    recoveryAttempts.set(workerId,0);
    log('WORKER_WINDOW_CLOSED',{workerId,windowId:Number.isFinite(windowId)?windowId:null,recoveryEligible,plannedRefresh,ownerInteractionMode:paused?'READ_ONLY':'AUTOMATION'});
    persistEvidence();
    if(recoveryEligible)void recoveryTick();
    json(res,202,{ok:true,recoveryEligible});
    return true;
  }
  if(url.pathname==='/api/continuity/event'&&req.method==='POST'){
    const data=await body(req);
    const workerId=String(data.workerId??'') as WorkerId;
    const event=String(data.event??'').trim().toUpperCase();
    if(workerId!=='NV02'){json(res,400,{ok:false,error:'CONTINUITY_NV02_ONLY'});return true;}
    if(!/^[A-Z0-9_]{3,64}$/.test(event)){json(res,400,{ok:false,error:'CONTINUITY_EVENT_INVALID'});return true;}
    const safeData=Object.fromEntries(Object.entries(data).filter(([key])=>!['workerId','event'].includes(key)).slice(0,20));
    log('NV02_CONTINUITY_EVENT',{workerId,event,...safeData});
    persistEvidence();
    json(res,202,{ok:true});
    return true;
  }
  if(url.pathname==='/api/workers/NV02/restart-schedule'&&req.method==='POST'){
    try{
      if(paused)throw new Error('OWNER_INTERACTION_READ_ONLY');
      if(killed)throw new Error('CONTROLLER_KILLED');
      const state=states.get('NV02')!;
      if(!state.enabled)throw new Error('WORKER_DISABLED:NV02');
      if(state.blocked)throw new Error('WORKER_BLOCKED:NV02');
      if(!recentHeartbeat('NV02'))throw new Error('NV02_HEARTBEAT_NOT_FRESH');
      if(state.lastHeartbeat?.uiBusy!==false)throw new Error('NV02_UI_NOT_IDLE');
      if(workerHasActiveJob('NV02'))throw new Error('NV02_ACTIVE_JOB');
      const data=await body(req);
      const reason=String(data.reason??'PLANNED_REFRESH').slice(0,96);
      plannedRefreshWorkers.add('NV02');
      state.manualCloseSuppressed=false;
      persistWorkerSafetyState();
      log('NV02_PLANNED_REFRESH_QUEUED',{workerId:'NV02',reason});
      void uiQueue.enqueue(()=>sendCommand('NV02','CLOSE_WINDOW')).catch((error)=>{
        plannedRefreshWorkers.delete('NV02');
        log('NV02_PLANNED_REFRESH_QUEUE_FAILED',{workerId:'NV02',reason,error:String(error)});
        persistEvidence();
      });
      json(res,202,{ok:true,queued:true});
    }catch(error){json(res,409,{ok:false,error:String(error)});}
    return true;
  }
  if(url.pathname.startsWith('/api/commands/')&&req.method==='GET'){
    const workerId=decodeURIComponent(url.pathname.split('/').pop()!) as WorkerId;
    if(!getWorker(workerId)){json(res,404,{ok:false});return true;}
    if(!states.get(workerId)!.enabled){json(res,200,{command:null,disabled:true,error:`WORKER_DISABLED:${workerId}`});return true;}
    const mutationLease=browserMutationLeases.active(workerId);
    if(mutationLease){json(res,200,{command:null,mutationLease:{ownerId:mutationLease.ownerId,expiresAt:mutationLease.expiresAt}});return true;}
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
          if(utilityPausedWorkers.has(worker.id)){log('START_ALL_SKIPPED_UTILITY_PAUSED',{workerId:worker.id});continue;}
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
  const jobMatch=url.pathname.match(/^\/api\/utility\/workers\/(NV02|NV03|NV04)\/job(?:\/status)?$/);
  if(jobMatch){
    const workerId=jobMatch[1] as WorkerId;
    if(req.method==='GET'){
      json(res,200,{ok:true,workerId,active:uiJobLedger.active(workerId)??null,latest:uiJobLedger.latest(workerId)??null});
      return true;
    }
    if(req.method!=='POST'){json(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});return true;}
    try{
      const data=await body(req);
      const jobId=String(data.jobId??'').trim();
      if(!jobId)throw new Error('UI_JOB_ID_REQUIRED');
      if(!isUiJobStage(data.stage))throw new Error('UI_JOB_STAGE_INVALID');
      const current=uiJobLedger.get(workerId,jobId);
      if(!current)throw new Error(`UI_JOB_NOT_FOUND:${workerId}:${jobId}`);
      const evidenceRef=typeof data.evidenceRef==='string'?data.evidenceRef.trim():undefined;
      if(evidenceRef&&!evidenceRef.startsWith('https://github.com/'))throw new Error('UI_JOB_EVIDENCE_REF_NOT_GITHUB');
      if(data.stage==='VERIFY'||data.stage==='DONE'){
        if(!current.issueRef)throw new Error('UI_JOB_ISSUE_REF_REQUIRED_FOR_COMPLETION');
        if(!evidenceRef)throw new Error('UI_JOB_COMPLETION_EVIDENCE_REQUIRED');
        if(!(evidenceRef===current.issueRef||evidenceRef.startsWith(`${current.issueRef}#`)))
          throw new Error('UI_JOB_COMPLETION_EVIDENCE_IDENTITY_MISMATCH');
      }
      const result=typeof data.result==='string'?data.result.trim():'';
      if(data.stage==='DONE'&&!result)throw new Error('UI_JOB_DONE_RESULT_REQUIRED');
      const record=uiJobLedger.transition(workerId,jobId,data.stage,{
        nextAction:typeof data.nextAction==='string'?data.nextAction:null,
        blocker:typeof data.blocker==='string'?data.blocker:null,
        evidenceRef,
        result:result||null,
      });
      log('UI_JOB_STATUS_UPDATED',{workerId,jobId,stage:record.stage,progress:record.progress,evidenceRef:evidenceRef??null});
      persistEvidence();
      json(res,200,{ok:true,job:record});
    }catch(error){json(res,409,{ok:false,error:String(error)});}
    return true;
  }
  const browserLeaseMatch=url.pathname.match(/^\/api\/utility\/workers\/(NV02|NV03|NV04)\/mutation-lease(?:\/(acquire|release))?$/);
  if(browserLeaseMatch){
    const workerId=browserLeaseMatch[1] as WorkerId;
    const leaseAction=browserLeaseMatch[2]??'status';
    try{
      if(leaseAction==='status'&&req.method==='GET'){
        json(res,200,{ok:true,workerId,lease:browserMutationLeases.active(workerId)??null});
        return true;
      }
      if(req.method!=='POST'){json(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});return true;}
      const data=await body(req);
      const ownerId=String(data.ownerId??'').trim();
      if(leaseAction==='acquire'){
        assertWorkerEnabled(workerId);
        const state=states.get(workerId)!;
        if(paused)throw new Error('OWNER_INTERACTION_READ_ONLY');
        if(utilityPausedWorkers.has(workerId))throw new Error(`UTILITY_WORKER_PAUSED:${workerId}`);
        if(state.blocked)throw new Error(`WORKER_BLOCKED:${workerId}`);
        if(!recentHeartbeat(workerId))throw new Error(`WORKER_HEARTBEAT_NOT_READY:${workerId}`);
        const security=heartbeatStopReason(state.lastHeartbeat);
        if(security)throw new Error(security);
        if(state.lastHeartbeat?.uiBusy!==false)throw new Error(`WORKER_UI_BUSY_OR_UNKNOWN:${workerId}`);
        if(workerHasActiveJob(workerId))throw new Error(`WORKER_ACTIVE_JOB:${workerId}`);
        if(commandQueues.get(workerId)!.length>0||[...waiters.values()].some((w)=>w.workerId===workerId))
          throw new Error(`WORKER_COMMAND_INFLIGHT:${workerId}`);
        const ttlMs=Number(data.ttlMs??30_000);
        const acquired=browserMutationLeases.acquire(workerId,ownerId,ttlMs);
        if(acquired.kind==='BUSY'){
          json(res,409,{ok:false,error:`BROWSER_MUTATION_LEASE_BUSY:${workerId}:${acquired.lease.ownerId}`,lease:acquired.lease});
          return true;
        }
        log('BROWSER_MUTATION_LEASE_ACQUIRED',{workerId,ownerId,leaseId:acquired.lease.leaseId,expiresAt:acquired.lease.expiresAt});
        json(res,200,{ok:true,lease:acquired.lease});
        return true;
      }
      if(leaseAction==='release'){
        const leaseId=String(data.leaseId??'').trim();
        const released=browserMutationLeases.release(workerId,ownerId,leaseId);
        log('BROWSER_MUTATION_LEASE_RELEASED',{workerId,ownerId,leaseId,released});
        json(res,200,{ok:true,released});
        return true;
      }
      json(res,404,{ok:false,error:'UNKNOWN_MUTATION_LEASE_ACTION'});
    }catch(error){json(res,409,{ok:false,error:String(error)});}
    return true;
  }
  const utilityMatch=url.pathname.match(/^\/api\/utility\/workers\/(NV02|NV03|NV04)\/(health|pause|resume|open-canonical|archive|safe-recover)$/);
  if(utilityMatch){
    const workerId=utilityMatch[1] as WorkerId; const action=utilityMatch[2]; const state=states.get(workerId)!; const worker=getWorker(workerId)!;
    try{
      if(action==='health'&&req.method==='GET'){
        let bridgeOk=false;try{const r=await fetch('http://127.0.0.1:8799/health',{signal:AbortSignal.timeout(1500)});bridgeOk=r.ok;}catch{}
        json(res,200,{ok:true,workerId,controller:true,bridgeOk,interactiveSession:isInteractiveDesktopSession(),sessionName:process.env.SESSIONNAME??null,utilityPaused:utilityPausedWorkers.has(workerId),state});return true;
      }
      if(req.method!=='POST'){json(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});return true;}
      if(action==='pause'){
        utilityPausedWorkers.add(workerId);
        state.status='PAUSED';state.lastError=undefined;recoveryAttempts.set(workerId,0);
        persistWorkerSafetyState();
        log('UTILITY_WORKER_PAUSED',{workerId});persistEvidence();json(res,200,{ok:true});return true;
      }
      if(action==='resume'){
        utilityPausedWorkers.delete(workerId);
        state.manualCloseSuppressed=false;
        persistWorkerSafetyState();
        state.status=recentHeartbeat(workerId)?'READY':'IDLE';
        state.lastError=undefined;
        recoveryAttempts.set(workerId,0);
        log('UTILITY_WORKER_RESUMED',{workerId});persistEvidence();
        if(!recentHeartbeat(workerId))void recoverWorker(workerId);
        if(workerId==='NV02')void autopilotTick();
        json(res,200,{ok:true});return true;
      }
      assertWorkerEnabled(workerId);
      if(action==='open-canonical'){await uiQueue.enqueue(()=>sendCommand(workerId,'NAVIGATE',{url:worker.homeUrl}));json(res,200,{ok:true});return true;}
      if(action==='safe-recover'){browserMutationLeases.assertControllerAllowed(workerId);if(utilityPausedWorkers.has(workerId))throw new Error(`UTILITY_WORKER_PAUSED:${workerId}`);if(state.blocked)throw new Error('SAFE_RECOVER_BLOCKED'); if(recentHeartbeat(workerId)){await layoutWorker(workerId);json(res,200,{ok:true,mode:'ATTACH_EXISTING'});return true;} await startWorker(workerId);json(res,200,{ok:true,mode:'BROKER_LAUNCH'});return true;}
      if(action==='archive'){const data=await body(req);if(typeof data.receiptRef!=='string'||!data.receiptRef.startsWith('https://github.com/'))throw new Error('ARCHIVE_DURABLE_RECEIPT_REQUIRED');if(workerHasActiveJob(workerId)||state.lastHeartbeat?.uiBusy)throw new Error('ARCHIVE_ACTIVE_JOB_FORBIDDEN');await uiQueue.enqueue(()=>sendCommand(workerId,'ARCHIVE_CHAT',{receiptRef:data.receiptRef}));json(res,200,{ok:true});return true;}
    }catch(error){json(res,409,{ok:false,error:String(error)});return true;}
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
          persistWorkerSafetyState();
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
          const jobData=data.job&&typeof data.job==='object'&&!Array.isArray(data.job)?data.job as Record<string,unknown>:{};
          await dispatch(workerId,data.text,data.navigate!==false,'MANUAL',{
            jobId:typeof jobData.jobId==='string'?jobData.jobId:undefined,
            issueRef:typeof jobData.issueRef==='string'?jobData.issueRef:undefined,
            title:typeof jobData.title==='string'?jobData.title:undefined,
            source:typeof jobData.source==='string'?jobData.source:'SYSTEM',
          });
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
