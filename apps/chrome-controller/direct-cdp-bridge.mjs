import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  CONTINUE_MIN_MS, CONTINUE_MAX_MS, REFRESH_MIN_MS, REFRESH_MAX_MS,
  WORKER_F5_MIN_MS, WORKER_F5_MAX_MS, CONTINUITY_WORKERS,
  MAX_STALLED_CHECKS, WORKING_PROGRESS_CHECK_MS, MAX_WORKING_UNCHANGED_CHECKS, shouldRotateNv02Chat,
  deriveNv02Phase, deriveWorkerPhase, hasActiveNv02Work, hasWaitingEvidenceNv02Work, hasContinuableNv02Work, hasContinuableWorkerWork,
  nextRandomAt, randomDelay, pickContinuePrompt, computeWorkerStaggerDelay,
} from './extension/continuity.js';
import { buildDurableSavePrompt, waitForDurableSaveReceipt } from './extension/save-receipt.js';

const CONFIG='D:\\TigerIQ\\Apps\\ChromeController\\Config\\chrome-controller.json';
const LOG='D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\direct-cdp-bridge.jsonl';
const SEND_BUTTON_WAIT_MS=10000;
const NV02_CONTINUITY_STATE='D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\nv02-continuity-state.json';
const CONTROLLER='http://127.0.0.1:8798';
const BINDING='2';
const NV02_TOKEN=String(process.env.TIGERIQ_NV02_WORKER_TOKEN||'').trim();
const APPROVED_HEAD=String(process.env.TIGERIQ_APPROVED_HEAD||'').trim();
const DEPLOY_ROOT=String(process.env.TIGERIQ_DEPLOY_ROOT||'').trim();
const EXPECTED_BRIDGE_SHA256=String(process.env.TIGERIQ_NV02_BRIDGE_SHA256||'').trim().toLowerCase();
const BRIDGE_PATH=fs.realpathSync(process.argv[1]);
const BRIDGE_SHA256=createHash('sha256').update(fs.readFileSync(BRIDGE_PATH)).digest('hex');
if(EXPECTED_BRIDGE_SHA256&&EXPECTED_BRIDGE_SHA256!==BRIDGE_SHA256){
  console.error('FAIL_CLOSED: NV02 bridge source hash does not match approved artifact.');
  process.exit(44);
}
const config=JSON.parse(fs.readFileSync(CONFIG,'utf8'));
const NV02_HOME_URL=String(config.workers.find((worker)=>worker.id==='NV02')?.homeUrl||'').trim();
const NV02_PROJECT_PREFIX=(()=>{try{return new URL(NV02_HOME_URL).pathname.replace(/\/project\/?$/,'')}catch{return''}})();
const NV02_PROJECT_ID=(()=>{const m=NV02_PROJECT_PREFIX.match(/^\/g\/(g-p-[a-z0-9]+)(?:-[^/]+)?$/i);return m?.[1]||''})();
const NV02_PROJECT_ID_PREFIX=NV02_PROJECT_ID?`/g/${NV02_PROJECT_ID}`:'';
const busy=new Set();
const workerConnectivityBackoff=new Map();
let nv02VerifiedModelProfile=null;
let nv02MutationBusy=false;
let nv02BootF5ScheduleInitialized=false;
const NV02_ISOLATED_AUTO_CONTINUE=true;
const NV02_F5_MIN_MS=5*60*1000;
const NV02_F5_MAX_MS=20*60*1000;
const UI_STABILITY_PACING_MIN_MS=1200;
const UI_STABILITY_PACING_MAX_MS=4000;
const VIEW_FOLLOW_MIN_MS=30*1000;
const VIEW_FOLLOW_MAX_MS=75*1000;
function applyNv02VerifiedModelProfile(ui){
  const sameUrl=Boolean(nv02VerifiedModelProfile&&ui?.url&&nv02VerifiedModelProfile.url===ui.url);
  const reasoningHigh=ui?.reasoningEffort==='High';
  if(!sameUrl||!reasoningHigh)return ui;
  const exact={...ui,modelProfileStatus:'MODEL_PROFILE_VERIFIED',modelName:'GPT-5.6 Sol',reasoningEffort:'High',modelReady:true,modelExact:true,verifiedAt:nv02VerifiedModelProfile.verifiedAt,blockedReason:null};
  exact.uiPhase=exact.securityBlock?'BLOCKED':exact.uiBusy?'WORKING':exact.uiReady?'READY':'STALLED';
  return exact;
}

function isNv02ProjectContext(url){
  if(!NV02_PROJECT_PREFIX)return false;
  try{
    const current=new URL(String(url||''));
    const expected=new URL(NV02_HOME_URL);
    if(current.hostname!==expected.hostname)return false;
    if(current.pathname===expected.pathname)return true;
    if(current.pathname.startsWith(NV02_PROJECT_PREFIX+'/c/'))return true;
    const currentProjectId=(current.pathname.match(/^\/g\/(g-p-[a-z0-9]+)(?:-[^/]+)?(?:\/|$)/i)||[])[1]||'';
    return Boolean(NV02_PROJECT_ID)&&currentProjectId===NV02_PROJECT_ID;
  }catch{return false}
}
function hasCurrentNv02Chat(url){
  if(!isNv02ProjectContext(url))return false;
  try{return /\/c\//.test(new URL(String(url||'')).pathname);}catch{return false}
}
function sameNv02Chat(a,b){
  try{
    const x=new URL(String(a||'')),y=new URL(String(b||''));
    return x.origin===y.origin&&x.pathname===y.pathname&&/\/c\//.test(x.pathname);
  }catch{return false}
}


const WORKER_CONTINUITY_DIR='D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\worker-continuity';
try{fs.mkdirSync(WORKER_CONTINUITY_DIR,{recursive:true});}catch{}
const workerMutationBusy=new Set();
const bootResetScheduleInitialized=new Set();
const bootF5ScheduleInitialized=new Set();
const WORKER_RESET_MAX_ATTEMPTS=2;
const WORKER_RESET_STAGGER_MS=2*60*1000;
const STALLED_CONFIRM_GRACE_MS=20*1000;
function workerStatePath(workerId){return join(WORKER_CONTINUITY_DIR,`${String(workerId).toLowerCase()}.json`);}
function nextWorkerResetAt(workerId,now=Date.now(),random=Math.random){
  const index=Math.max(0,CONTINUITY_WORKERS.indexOf(workerId));
  const offset=computeWorkerStaggerDelay(index,0,WORKER_RESET_STAGGER_MS);
  const maxDelay=Math.max(REFRESH_MIN_MS,REFRESH_MAX_MS-offset);
  return now+offset+randomDelay(REFRESH_MIN_MS,maxDelay,random);
}
function loadWorkerContinuity(workerId){
  const now=Date.now();let raw={};
  try{raw=JSON.parse(fs.readFileSync(workerStatePath(workerId),'utf8'));}catch{}
  let nextResetAt=Number(raw.nextResetAt)||nextWorkerResetAt(workerId,now);
  if(!bootResetScheduleInitialized.has(workerId)){
    bootResetScheduleInitialized.add(workerId);
    if(nextResetAt<=now){
      const previousNextResetAt=nextResetAt;
      nextResetAt=nextWorkerResetAt(workerId,now);
      log('WORKER_RESET_TIMER_REBASED_AFTER_RESTART',{workerId,previousNextResetAt,nextResetAt});
    }
  }
  let nextPeriodicF5At=Number(raw.nextPeriodicF5At)||nextRandomAt(now,WORKER_F5_MIN_MS,WORKER_F5_MAX_MS);
  if(!bootF5ScheduleInitialized.has(workerId)){
    bootF5ScheduleInitialized.add(workerId);
    if(nextPeriodicF5At<=now){
      const previousNextPeriodicF5At=nextPeriodicF5At;
      nextPeriodicF5At=nextRandomAt(now,WORKER_F5_MIN_MS,WORKER_F5_MAX_MS);
      log('WORKER_F5_TIMER_REBASED_AFTER_RESTART',{workerId,previousNextPeriodicF5At,nextPeriodicF5At});
    }
  }
  return {
    workerId,
    nextContinueAt:Number(raw.nextContinueAt)||nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS),
    nextPeriodicF5At,
    nextViewFollowAt:Number(raw.nextViewFollowAt)||nextRandomAt(now,VIEW_FOLLOW_MIN_MS,VIEW_FOLLOW_MAX_MS),
    nextResetAt,
    lastPrompt:String(raw.lastPrompt||''),
    lastPhase:String(raw.lastPhase||'STALLED'),
    resumeUrl:String(raw.resumeUrl||''),
    workingSignature:String(raw.workingSignature||''),
    workingUnchangedChecks:Number(raw.workingUnchangedChecks)||0,
    nextProgressCheckAt:Number(raw.nextProgressCheckAt)||0,
    stalledChecks:Number(raw.stalledChecks)||0,
    recoveryAttempts:Number(raw.recoveryAttempts)||0,
    recoveryBlockedUntil:Number(raw.recoveryBlockedUntil)||0,
    chatLoadRecoveryStage:Number(raw.chatLoadRecoveryStage)||0,
    chatLoadBlockedUntil:Number(raw.chatLoadBlockedUntil)||0,
    chatLoadClearCandidateAt:Number(raw.chatLoadClearCandidateAt)||0,
    chatLoadClearCandidateAt:Number(raw.chatLoadClearCandidateAt)||0,
  };
}
function saveWorkerContinuity(workerId,state){
  const target=workerStatePath(workerId),tmp=target+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify({...state,workerId,updatedAt:new Date().toISOString()},null,2));
  fs.renameSync(tmp,target);
}
function validWorkerUrl(w,url){
  try{return new URL(String(url||'')).hostname===expectedHost(w);}catch{return false}
}
function isAssignedWorkerChat(w,url){
  if(!validWorkerUrl(w,url))return false;
  try{
    const current=new URL(String(url||'')),home=new URL(String(w.homeUrl||''));
    if(current.hostname==='chatgpt.com'){
      const homePrefix=home.pathname.replace(/\/project\/?$/,'');
      const match=homePrefix.match(/^\/g\/(g-p-[a-z0-9]+)(?:-[^/]+)?$/i);
      const idPrefix=match?.[1]?'/g/'+match[1]:'';
      return /\/c\//.test(current.pathname)
        &&(current.pathname.startsWith(homePrefix+'/c/')||Boolean(idPrefix)&&current.pathname.startsWith(idPrefix+'/c/'));
    }
    if(current.hostname==='gemini.google.com'){
      return current.origin===home.origin&&(current.pathname===home.pathname||/^\/app\/[A-Za-z0-9_-]+\/?$/.test(current.pathname));
    }
    return current.origin===home.origin&&current.pathname===home.pathname;
  }catch{return false}
}
async function workerAutomationPaused(workerId){
  try{
    const state=await getControllerState();
    return state?.paused===true||state?.killed===true||String(state?.ownerInteractionMode||'')==='READ_ONLY'||(state?.utilityPausedWorkers||[]).includes(workerId);
  }catch(error){
    log('WORKER_AUTOMATION_PAUSE_CHECK_FAILED_CLOSED',{workerId,error:String(error?.message||error)});
    return true;
  }
}
async function withWorkerMutation(workerId,fn,purpose='CONTINUITY',ttlMs=30000){
  if(workerMutationBusy.has(workerId))return{ok:false,status:'MUTATION_LEASE_BUSY'};
  const lease=await acquireBridgeMutationLease(workerId,purpose,ttlMs);
  if(!lease)return{ok:false,status:'MUTATION_LEASE_BUSY'};
  workerMutationBusy.add(workerId);
  try{
    log('WORKER_LOCAL_MUTATION_ACQUIRED',{workerId,purpose,leaseId:lease.leaseId});
    return await fn(lease);
  }finally{
    workerMutationBusy.delete(workerId);
    await releaseBridgeMutationLease(workerId,lease);
    log('WORKER_LOCAL_MUTATION_RELEASED',{workerId,purpose,leaseId:lease.leaseId});
  }
}
async function genericWorkerEvent(workerId,event,data={}){
  log('WORKER_CONTINUITY_EVENT',{workerId,event,...data});
}
async function reopenWorker(w,target,state,now,reason){
  if(Number(state.recoveryBlockedUntil)>now)return state;
  if(state.recoveryAttempts>=WORKER_RESET_MAX_ATTEMPTS){
    const blocked={...state,recoveryAttempts:0,recoveryBlockedUntil:now+15*60*1000,lastPhase:'STALLED'};
    saveWorkerContinuity(w.id,blocked);
    await genericWorkerEvent(w.id,'RECOVERY_BOUNDED_STOP',{reason,recoveryBlockedUntil:blocked.recoveryBlockedUntil});
    return blocked;
  }
  const resumeUrl=validWorkerUrl(w,state.resumeUrl)?state.resumeUrl:(validWorkerUrl(w,target?.url)?target.url:'');
  const checkpointed={...state,resumeUrl,recoveryAttempts:state.recoveryAttempts+1,lastPhase:'STALLED'};
  saveWorkerContinuity(w.id,checkpointed);
  await genericWorkerEvent(w.id,'RESET_CHECKPOINTED',{reason,resumeUrl,recoveryAttempt:checkpointed.recoveryAttempts});
  const closeResult=await withWorkerMutation(w.id,async(lease)=>{
    await post(`/api/utility/workers/${w.id}/plan-refresh`,w.id,{reason,leaseOwnerId:lease.ownerId,leaseId:lease.leaseId});
    await closeWorker(w,target);
    return {ok:true,status:'WORKER_CLOSED_FOR_REOPEN'};
  },`WORKER_REOPEN_CLOSE:${reason}`,60000);
  if(closeResult?.status==='MUTATION_LEASE_BUSY'){
    const deferred={...checkpointed,recoveryBlockedUntil:now+5000};
    saveWorkerContinuity(w.id,deferred);
    return deferred;
  }

  await sleep(1200);
  let reopened=null,lastError=null;
  for(let attempt=1;attempt<=WORKER_RESET_MAX_ATTEMPTS;attempt+=1){
    try{
      await post(`/api/utility/workers/${w.id}/safe-recover`,w.id,{reason},120000);
      let replacement=null;
      for(let poll=0;poll<20;poll+=1){
        await sleep(750);
        try{
          const list=await targets(workerPort(w));
          replacement=await pruneDuplicates(w,list);
          if(replacement)break;
        }catch{}
      }
      if(!replacement)throw new Error('WORKER_REOPEN_TARGET_NOT_FOUND');
      if(resumeUrl&&validWorkerUrl(w,resumeUrl)&&replacement.url!==resumeUrl){
        const restoreResult=await withWorkerMutation(w.id,async()=>{
          await navigate(replacement,resumeUrl);
          await sleep(1200);
          return {ok:true,status:'WORKER_RESUME_URL_RESTORED'};
        },`WORKER_RESUME_NAVIGATE:${reason}`,30000);
        if(restoreResult?.status==='MUTATION_LEASE_BUSY')throw new Error('MUTATION_LEASE_BUSY');
      }
      reopened={ok:true,status:'WORKER_REOPENED',attempt,resumeUrl};
      break;
    }catch(error){
      lastError=error;
      await sleep(attempt*1500);
    }
  }
  if(!reopened)throw lastError||new Error('WORKER_REOPEN_FAILED');
  const recovered={...checkpointed,recoveryAttempts:0,recoveryBlockedUntil:0,stalledChecks:0,workingSignature:'',workingUnchangedChecks:0,nextProgressCheckAt:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS),nextPeriodicF5At:nextRandomAt(now,WORKER_F5_MIN_MS,WORKER_F5_MAX_MS),nextResetAt:nextWorkerResetAt(w.id,now),lastPhase:'STALLED'};
  saveWorkerContinuity(w.id,recovered);
  await genericWorkerEvent(w.id,'WORKER_REOPENED',{reason,resumeUrl,nextResetAt:recovered.nextResetAt});
  return recovered;
}
async function maybeWorkerContinuity(w,target,ui){
  const now=Date.now();
  let state=loadWorkerContinuity(w.id);
  const phase=deriveWorkerPhase(ui||{},{workerId:w.id});
  if(isAssignedWorkerChat(w,ui?.url))state={...state,resumeUrl:String(ui.url||''),lastPhase:phase};
  else state={...state,lastPhase:phase};
  saveWorkerContinuity(w.id,state);

  if(await workerAutomationPaused(w.id)){
    await genericWorkerEvent(w.id,'AUTO_ACTION_PAUSED',{phase});
    return;
  }
  if(phase==='BLOCKED'){
    await genericWorkerEvent(w.id,'BLOCKED',{securityBlock:ui?.securityBlock||null});
    return;
  }
  if(!validWorkerUrl(w,ui?.url)){
    await genericWorkerEvent(w.id,'WRONG_WORKER_CONTEXT',{url:ui?.url||null,expectedHost:expectedHost(w)});
    return;
  }
  if(ui?.scrollToBottomVisible===true&&now>=Number(state.nextViewFollowAt||0)){
    const locallyBusy=workerMutationBusy.has(w.id);
    const followed=locallyBusy
      ? {ok:false,status:'VIEW_FOLLOW_LOCAL_BUSY'}
      : await scrollToBottom(target).catch(error=>({ok:false,status:'VIEW_FOLLOW_ERROR',error:String(error?.message||error)}));
    state=loadWorkerContinuity(w.id);
    const deferred=followed?.status==='VIEW_FOLLOW_LOCAL_BUSY';
    state={...state,nextViewFollowAt:deferred?now+5000:nextRandomAt(now,VIEW_FOLLOW_MIN_MS,VIEW_FOLLOW_MAX_MS)};
    saveWorkerContinuity(w.id,state);
    await genericWorkerEvent(w.id,deferred?'VIEW_FOLLOW_BOTTOM_DEFERRED':'VIEW_FOLLOW_BOTTOM',{status:followed?.status||null,pacingMs:followed?.pacingMs||null,nextViewFollowAt:state.nextViewFollowAt});
  }
  if(await maybeRecoverChatLoadError(w,target,ui,now))return;

  if(phase==='STALLED'&&Number(state.recoveryBlockedUntil||0)>now){
    return;
  }

  if(phase!=='WORKING'&&now>=Number(state.nextResetAt||0)){
    await reopenWorker(w,target,state,now,'PERIODIC_2_4H_RESET');
    return;
  }

  if(phase!=='WORKING'&&Number(state.nextPeriodicF5At||0)<=now){
    const refreshed=await withWorkerMutation(w.id,async()=>{
      const beforeUrl=ui?.url||null,beforePhase=phase;
      const result=await reloadTarget(target);
      await sleep(1600);
      const after=await uiStateRaw(target).catch(()=>null);
      return {ok:true,status:result?.status||'RELOADED',beforeUrl,beforePhase,afterUrl:after?.url||null,afterPhase:deriveWorkerPhase(after||{},{workerId:w.id})};
    },'PERIODIC_F5_REFRESH',15000);
    const next={...state,nextPeriodicF5At:refreshed?.status==='MUTATION_LEASE_BUSY'?now+5000:nextRandomAt(now,WORKER_F5_MIN_MS,WORKER_F5_MAX_MS),workingSignature:'',workingUnchangedChecks:0,nextProgressCheckAt:0};
    saveWorkerContinuity(w.id,next);
    await genericWorkerEvent(w.id,'PERIODIC_F5_REFRESH',{status:refreshed?.status||null,beforeUrl:refreshed?.beforeUrl||ui?.url||null,afterUrl:refreshed?.afterUrl||null,nextPeriodicF5At:next.nextPeriodicF5At});
    return;
  }

  if(phase==='WORKING'){
    if(now<Number(state.nextProgressCheckAt||0))return;
    const signature=String(ui?.activitySignature||'');
    const unchanged=Boolean(signature&&state.workingSignature===signature)?Number(state.workingUnchangedChecks||0)+1:0;
    const next={...state,workingSignature:signature,workingUnchangedChecks:unchanged,nextProgressCheckAt:now+WORKING_PROGRESS_CHECK_MS,stalledChecks:0};
    saveWorkerContinuity(w.id,next);
    await genericWorkerEvent(w.id,'WORKING_PROGRESS_CHECK',{workingUnchangedChecks:unchanged});
    if(unchanged>=MAX_WORKING_UNCHANGED_CHECKS){
      await genericWorkerEvent(w.id,'WORKING_LONG_RUNNING_NO_MUTATION',{workingUnchangedChecks:unchanged});
    }
    if(unchanged>=MAX_WORKING_UNCHANGED_CHECKS+2){
      const recovered=await withWorkerMutation(w.id,async()=>{
        const stopped=await stopStalledWorking(target);
        if(stopped?.ok)return {...stopped,method:'STOP'};
        const reloaded=await reloadTarget(target);
        await sleep(1800);
        const after=await uiStateRaw(target).catch(()=>null);
        return {ok:true,status:'WORKING_STUCK_RELOADED',method:'RELOAD',reloadStatus:reloaded?.status||null,afterBusy:after?.uiBusy===true,afterPhase:deriveWorkerPhase(after||{},{workerId:w.id})};
      },'WORKING_STUCK_RECOVERY',30000);
      const attempts=Number(state.recoveryAttempts||0)+1;
      const resolved=recovered?.status!=='MUTATION_LEASE_BUSY'&&(recovered?.afterBusy!==true);
      const repaired={...loadWorkerContinuity(w.id),workingSignature:'',workingUnchangedChecks:0,nextProgressCheckAt:now+WORKING_PROGRESS_CHECK_MS,recoveryAttempts:resolved?0:attempts,recoveryBlockedUntil:resolved?0:now+60_000};
      saveWorkerContinuity(w.id,repaired);
      await genericWorkerEvent(w.id,'WORKING_STUCK_RECOVERY',{status:recovered?.status||null,method:recovered?.method||null,resolved,recoveryAttempts:repaired.recoveryAttempts});
      if(!resolved&&attempts>=WORKER_RESET_MAX_ATTEMPTS)await reopenWorker(w,target,repaired,now,'WORKING_STUCK_BOUNDED_REOPEN');
    }
    return;
  }

  if(phase==='READY'){
    if(state.stalledChecks||state.recoveryAttempts||state.recoveryBlockedUntil){
      state={...state,stalledChecks:0,recoveryAttempts:0,recoveryBlockedUntil:0};
      saveWorkerContinuity(w.id,state);
      await genericWorkerEvent(w.id,'READY_RECOVERY_STATE_CLEARED');
    }
    if(now<Number(state.nextContinueAt||0))return;
    if(!isAssignedWorkerChat(w,ui?.url)){
      const deferred={...state,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
      saveWorkerContinuity(w.id,deferred);
      await genericWorkerEvent(w.id,'CONTINUE_SKIPPED_NO_ASSIGNED_CHAT',{url:ui?.url||null,nextContinueAt:deferred.nextContinueAt});
      return;
    }
    let controllerState;
    try{controllerState=await getControllerState();}
    catch(error){
      const deferred={...state,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
      saveWorkerContinuity(w.id,deferred);
      await genericWorkerEvent(w.id,'CONTINUE_SKIPPED_CONTROLLER_UNREACHABLE',{error:String(error?.message||error)});
      return;
    }
    if(!hasContinuableWorkerWork(controllerState, w.id)){
      const deferred={...state,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
      saveWorkerContinuity(w.id,deferred);
      await genericWorkerEvent(w.id,'CONTINUE_SKIPPED_NO_CURRENT_WORK',{url:ui?.url||null});
      return;
    }
    const prompt=pickContinuePrompt(state.lastPrompt);
    const sent=await withWorkerMutation(w.id,()=>dispatch(target,prompt),'CONTINUITY_CONTINUE',30000);
    if(sent?.status==='MUTATION_LEASE_BUSY'){
      saveWorkerContinuity(w.id,{...state,nextContinueAt:now+5000});
      return;
    }
    if(!sent?.ok)throw new Error(sent?.status||'CONTINUE_DISPATCH_FAILED');
    const next={...state,lastPrompt:prompt,lastPhase:'WORKING',stalledChecks:0,recoveryAttempts:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
    saveWorkerContinuity(w.id,next);
    await genericWorkerEvent(w.id,'CONTINUE_DISPATCHED',{prompt,nextContinueAt:next.nextContinueAt});
    return;
  }

  const stalledChecks=Math.min(MAX_STALLED_CHECKS,Number(state.stalledChecks||0)+1);
  const next={...state,stalledChecks,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
  saveWorkerContinuity(w.id,next);
  await genericWorkerEvent(w.id,'STALLED_CHECK',{stalledChecks});
  if(stalledChecks===2){
    const refreshed=await withWorkerMutation(w.id,()=>reloadTarget(target),'STALLED_RECOVERY',15000);
    const confirmAfter=Date.now()+STALLED_CONFIRM_GRACE_MS;
    const guarded={...next,recoveryBlockedUntil:confirmAfter};
    saveWorkerContinuity(w.id,guarded);
    await genericWorkerEvent(w.id,'STALLED_RELOAD',{status:refreshed?.status||null,confirmAfter});
  }else if(stalledChecks>=MAX_STALLED_CHECKS){
    await reopenWorker(w,target,next,now,'STALLED_3_CHECKS');
  }
}

function log(event,data={}){
  const line=JSON.stringify({ts:new Date().toISOString(),event,...data});
  fs.appendFileSync(LOG,line+'\n');
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function stabilityPace(random=Math.random){
  const delayMs=randomDelay(UI_STABILITY_PACING_MIN_MS,UI_STABILITY_PACING_MAX_MS,random);
  await sleep(delayMs);
  return delayMs;
}
function loadNv02Continuity(){
  const now=Date.now();
  let raw={};
  try{raw=JSON.parse(fs.readFileSync(NV02_CONTINUITY_STATE,'utf8'));}catch{}
  const f5WindowVersion=2;
  let nextPeriodicF5At=Number(raw.nextPeriodicF5At)||nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS);
  let workingRecheckAt=Number(raw.workingRecheckAt)||0;
  if(Number(raw.f5WindowVersion)!==f5WindowVersion){
    nextPeriodicF5At=nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS);
    if(workingRecheckAt)workingRecheckAt=nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS);
  }
  if(!nv02BootF5ScheduleInitialized){
    nv02BootF5ScheduleInitialized=true;
    const previousNextPeriodicF5At=nextPeriodicF5At;
    const previousWorkingRecheckAt=workingRecheckAt;
    if(nextPeriodicF5At<=now)nextPeriodicF5At=nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS);
    if(workingRecheckAt&&workingRecheckAt<=now)workingRecheckAt=nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS);
    if(previousNextPeriodicF5At!==nextPeriodicF5At||previousWorkingRecheckAt!==workingRecheckAt){
      log('NV02_F5_TIMERS_REBASED_AFTER_RESTART',{previousNextPeriodicF5At,nextPeriodicF5At,previousWorkingRecheckAt,workingRecheckAt});
    }
  }
  return {
    nextContinueAt:Number(raw.nextContinueAt)||nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS),
    nextPeriodicF5At,
    f5WindowVersion,
    nextViewFollowAt:Number(raw.nextViewFollowAt)||nextRandomAt(now,VIEW_FOLLOW_MIN_MS,VIEW_FOLLOW_MAX_MS),
    nextRefreshAt:Number(raw.nextRefreshAt)||nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS),
    stalledChecks:Number(raw.stalledChecks)||0,
    lastPrompt:String(raw.lastPrompt||''),
    dispatchesInChat:Number(raw.dispatchesInChat)||0,
    chatStartedAt:Number(raw.chatStartedAt)||now,
    lastPhase:String(raw.lastPhase||'STALLED'),
    workingSignature:String(raw.workingSignature||''),
    workingUnchangedChecks:Number(raw.workingUnchangedChecks)||0,
    workingRecheckAt,
    nextProgressCheckAt:Number(raw.nextProgressCheckAt)||0,
    verifiedChatUrl:String(raw.verifiedChatUrl||''),
    resumeChatUrl:String(raw.resumeChatUrl||(hasCurrentNv02Chat(raw.verifiedChatUrl)?raw.verifiedChatUrl:'')||''),
    modelVerifiedAt:String(raw.modelVerifiedAt||''),
    modelCheckBlockedUntil:Number(raw.modelCheckBlockedUntil)||0,
    rotationRetryAt:Number(raw.rotationRetryAt)||0,
    chatLoadRecoveryStage:Number(raw.chatLoadRecoveryStage)||0,
    chatLoadBlockedUntil:Number(raw.chatLoadBlockedUntil)||0,
    chatLoadClearCandidateAt:Number(raw.chatLoadClearCandidateAt)||0,
  };
}
function applyNv02DurableVerifiedModelProfile(ui){
  if(!ui||ui.modelExact===true)return ui;
  if(ui.securityBlock||ui.authRequired||ui.chatLoadError)return ui;
  if(ui.modelControlPresent!==true||ui.reasoningEffort!=='High')return ui;
  const state=loadNv02Continuity();
  if(!state.verifiedChatUrl||!state.modelVerifiedAt||!sameNv02Chat(state.verifiedChatUrl,ui.url))return ui;
  const exact={...ui,modelProfileStatus:'MODEL_PROFILE_VERIFIED',modelName:'GPT-5.6 Sol',reasoningEffort:'High',modelReady:true,modelExact:true,verifiedAt:state.modelVerifiedAt,blockedReason:null};
  exact.uiPhase=exact.uiBusy?'WORKING':exact.uiReady?'READY':'STALLED';
  return exact;
}
function saveNv02Continuity(state){
  const tmp=NV02_CONTINUITY_STATE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify({...state,updatedAt:new Date().toISOString()},null,2));
  fs.renameSync(tmp,NV02_CONTINUITY_STATE);
}

function auth(workerId,json=false){
  const h={'x-tigeriq-binding-version':BINDING};
  if(json) h['content-type']='application/json; charset=utf-8';
  if(workerId==='NV02'){if(!NV02_TOKEN)throw new Error('NV02_WORKER_TOKEN_REQUIRED');h['x-tigeriq-worker-token']=NV02_TOKEN;}
  return h;
}
function workerPort(w){return Number(w.debugPort||({NV02:9222,NV03:9223,NV04:9224}[w.id]));}
function expectedHost(w){return new URL(w.homeUrl).hostname;}
class Rpc{
  constructor(url){this.url=url;this.ws=null;this.seq=0;this.wait=new Map();}
  async open(timeout=4000){
    this.ws=new WebSocket(this.url);
    await new Promise((ok,fail)=>{
      let settled=false;
      const timer=setTimeout(()=>{
        if(settled)return;
        settled=true;
        try{this.ws?.close();}catch{}
        fail(new Error('CDP_OPEN_TIMEOUT'));
      },timeout);
      this.ws.onopen=()=>{
        if(settled)return;
        settled=true;clearTimeout(timer);ok();
      };
      this.ws.onerror=()=>{
        if(settled)return;
        settled=true;clearTimeout(timer);fail(new Error('CDP_OPEN_ERROR'));
      };
    });
    this.ws.onmessage=(e)=>{
      const m=JSON.parse(e.data);
      if(!m.id||!this.wait.has(m.id)) return;
      const q=this.wait.get(m.id);this.wait.delete(m.id);clearTimeout(q.timer);
      m.error?q.fail(new Error(JSON.stringify(m.error))):q.ok(m.result);
    };
  }
  call(method,params={},timeout=6000){
    return new Promise((ok,fail)=>{
      const id=++this.seq;
      const timer=setTimeout(()=>{this.wait.delete(id);fail(new Error(`CDP_TIMEOUT:${method}`));},timeout);
      this.wait.set(id,{ok,fail,timer});
      this.ws.send(JSON.stringify({id,method,params}));
    });
  }
  close(){try{this.ws?.close();}catch{}}
}

async function targets(port){
  const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2500)});
  if(!r.ok) throw new Error(`CDP_LIST_${r.status}`);
  return r.json();
}
async function browserRpc(port){
  const v=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(2500)}).then(r=>r.json());
  const rpc=new Rpc(v.webSocketDebuggerUrl);await rpc.open();return rpc;
}
async function pageRpc(target){const rpc=new Rpc(target.webSocketDebuggerUrl);await rpc.open();return rpc;}

function pageTargetsFor(w,list){
  const host=expectedHost(w);
  return list.filter(t=>t.type==='page'&&(()=>{try{return new URL(t.url).hostname===host}catch{return false}})());
}
const duplicateObservationSignature=new Map();
function sameWorkerLocation(a,b){
  try{
    const x=new URL(String(a||'')),y=new URL(String(b||''));
    return x.origin===y.origin&&x.pathname===y.pathname;
  }catch{return false}
}
function preferredWorkerUrl(w){
  if(w.id==='NV02'){
    const state=loadNv02Continuity();
    return state.resumeChatUrl||state.verifiedChatUrl||'';
  }
  return loadWorkerContinuity(w.id).resumeUrl||'';
}
async function pruneDuplicates(w,list){
  const pages=pageTargetsFor(w,list);if(pages.length<=1)return pages[0]||null;
  const preferredUrl=preferredWorkerUrl(w);
  const homePath=(()=>{try{return new URL(w.homeUrl).pathname}catch{return''}})();
  const keep=pages.find(t=>sameWorkerLocation(t.url,preferredUrl))
    ||pages.find(t=>{try{return /\/c\//.test(new URL(t.url).pathname)}catch{return false}})
    ||pages.find(t=>{try{return new URL(t.url).pathname===homePath}catch{return false}})
    ||pages[0];
  const signature=pages.map(t=>t.id).sort().join(',')+'|'+keep.id;
  if(duplicateObservationSignature.get(w.id)!==signature){
    duplicateObservationSignature.set(w.id,signature);
    log('DUPLICATE_TABS_OBSERVED',{workerId:w.id,count:pages.length,kept:keep.id,keptUrl:keep.url,preferredUrl:preferredUrl||null});
  }
  return keep;
}
async function pruneNv03DuplicateTabs(w,list,keep,ui){
  if(w.id!=='NV03'||!keep||ui?.uiBusy===true)return;
  const pages=pageTargetsFor(w,list);
  const extras=pages.filter(t=>t.id!==keep.id);
  if(!extras.length)return;
  const pruned=await withWorkerMutation(w.id,async()=>{
    const rpc=await browserRpc(workerPort(w));
    let closed=0;
    try{
      for(const target of extras){
        const result=await rpc.call('Target.closeTarget',{targetId:target.id},4000).catch(()=>null);
        if(result?.success!==false)closed+=1;
      }
    }finally{rpc.close();}
    return{ok:true,status:'DUPLICATES_PRUNED',closed};
  },'DUPLICATE_TAB_PRUNE',15000);
  if(pruned?.status==='MUTATION_LEASE_BUSY')return;
  duplicateObservationSignature.delete(w.id);
  log('DUPLICATE_TABS_PRUNED',{workerId:w.id,kept:keep.id,keptUrl:keep.url,closed:Number(pruned?.closed||0)});
}

async function windowIdFor(port,targetId){
  const b=await browserRpc(port);
  try{return (await b.call('Browser.getWindowForTarget',{targetId})).windowId;}
  finally{b.close();}
}
const UI_EXPR=`(()=>{
  const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
  const sels=location.hostname==='chatgpt.com'
    ? ['#prompt-textarea','div[contenteditable="true"][data-lexical-editor="true"]','[contenteditable="true"][role="textbox"]','textarea']
    : ['rich-textarea .ql-editor[contenteditable="true"]','.ql-editor[contenteditable="true"]','[contenteditable="true"][role="textbox"]','textarea'];
  const composer=sels.flatMap(s=>[...document.querySelectorAll(s)]).find(vis)||null;
  const projectDraftLabels=['thay đổi dự án: tigeriq ai lab','change project: tigeriq ai lab'];
  const projectDraftReady=location.hostname==='chatgpt.com'&&[...document.querySelectorAll('button,[role="button"]')].some(e=>vis(e)&&projectDraftLabels.includes((e.getAttribute('aria-label')||'').trim().toLowerCase()));
  const authRequired=[...document.querySelectorAll('button,a')].some(e=>vis(e)&&/^(đăng nhập|sign in|log in)$/i.test((e.textContent||'').trim()));
  const stop=[...document.querySelectorAll('button[data-testid="stop-button"],button[aria-label*="Stop" i],button[aria-label*="Dừng" i],button[aria-label*="Ngừng" i]')].find(vis)||null;
  const activityBusy=[...document.querySelectorAll('button,[role="button"],[aria-live]')].find(e=>vis(e)&&/(^|\\s)(đang suy nghĩ|thinking|generating|đang tạo)(\\s|$)/i.test((e.getAttribute('aria-label')||e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()))||null;
  const send=composer?[...document.querySelectorAll('button[data-testid="send-button"],button[data-testid="composer-submit-button"],button[type="submit"],button[aria-label*="Gửi" i],button[aria-label*="Send" i]')].find(e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true')||null:null;
  const scroll=[...document.querySelectorAll('button,[role="button"]')].find(e=>vis(e)&&/^(cuộn xuống cuối|scroll to bottom|jump to bottom)$/i.test((e.getAttribute('aria-label')||e.textContent||'').trim()))||null;
  let securityBlock=null;
  if(document.querySelector('iframe[src*="captcha" i],iframe[src*="challenge" i],[class*="captcha" i],[id*="captcha" i]')) securityBlock='BLOCKED_CAPTCHA';
  const txt=[...document.querySelectorAll('[role="alert"],[role="dialog"],[data-testid*="toast" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' ');
  const checks=[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']];
  if(!securityBlock) for(const [n,s] of checks){if(txt.includes(n)){securityBlock=s;break;}}
  const pageText=String(document.body?.innerText||'').replace(/\s+/g,' ').trim();
  const chatRetry=[...document.querySelectorAll('button,[role="button"]')].find(e=>vis(e)&&/^(retry|thử lại)$/i.test((e.innerText||e.textContent||e.getAttribute('aria-label')||'').trim()))||null;
  const retryContext=(()=>{let e=chatRetry;const parts=[];for(let i=0;i<6&&e;i+=1,e=e.parentElement){const text=String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();if(text&&text.length<=800&&!parts.includes(text))parts.push(text);}return parts.join(' | ')})();
  const conversationLoadError=/(không thể tải cuộc hội thoại chatgpt này|unable to load (?:this )?(?:chatgpt )?conversation|failed to load (?:this )?(?:chatgpt )?conversation)/i.test(pageText);
  const requestTimeoutError=Boolean(chatRetry)&&/(yêu cầu (?:đã )?hết thời gian chờ|request (?:has )?timed out|request timeout)/i.test(retryContext);
  const chatLoadError=location.hostname==='chatgpt.com'&&Boolean(conversationLoadError||requestTimeoutError);
  const modelControls=location.hostname==='chatgpt.com'?[...document.querySelectorAll('button,[role="button"]')].filter(e=>vis(e)&&(e.hasAttribute('data-selected-reasoning-effort')||/chọn mô hình chatgpt|choose.*model|model selector/i.test((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'')))):[];
  const modelControl=modelControls.length===1?modelControls[0]:null;
  const modelLabel=String((modelControl?.getAttribute('aria-label')||'')+' '+(modelControl?.getAttribute('title')||'')+' '+(modelControl?.innerText||modelControl?.textContent||'')).replace(/\\s+/g,' ').trim();
  const modelName=/\\b(?:GPT-)?5\\.6\\s+Sol\\b/i.test(modelLabel)?'GPT-5.6 Sol':null;
  const reasoningRaw=modelControl?.getAttribute('data-selected-reasoning-effort')||modelLabel;
  const reasoningEffort=/(^|\\s)(high|cao)(\\s|$)/i.test(String(reasoningRaw||''))?'High':null;
  const modelExact=location.hostname!=='chatgpt.com'||Boolean(modelControl&&modelName==='GPT-5.6 Sol'&&reasoningEffort==='High');
  const modelReady=modelExact;
  const modelProfileStatus=modelExact?'MODEL_PROFILE_VERIFIED':'MODEL_PROFILE_BLOCKED';
  const blockedReason=modelExact?null:(!modelControl?'MODEL_CONTROL_NOT_EXACT_OR_UNIQUE':!modelName?'MODEL_NAME_NOT_GPT_5_6_SOL':'REASONING_NOT_HIGH');
  const verifiedAt=modelExact?new Date().toISOString():null;
  const uiBusy=location.hostname==='chatgpt.com'?Boolean(stop):Boolean(stop||activityBusy);
  const activityRoot=activityBusy?.closest?.('.block-BQZwFn')||activityBusy?.parentElement||null;
  const activityText=String(activityRoot?.innerText||activityRoot?.textContent||'').replace(/\s+/g,' ').trim();
  const assistantNodes=[...document.querySelectorAll('[data-message-author-role="assistant"],[data-content-search-unit-key$=":assistant"]')].filter(vis);
  const assistantText=String(assistantNodes.at(-1)?.innerText||assistantNodes.at(-1)?.textContent||'').replace(/\s+/g,' ').trim();
  const progressText=(assistantText+'|'+activityText).trim();
  let activityHash=0;for(let i=0;i<progressText.length;i+=1)activityHash=((activityHash*31)+progressText.charCodeAt(i))>>>0;
  const activitySignature=uiBusy?(String(progressText.length)+':'+String(activityHash)):'';
  const uiReady=document.readyState==='complete'&&!!composer&&!authRequired;
  const uiPhase=securityBlock?'BLOCKED':chatLoadError?'STALLED':uiBusy?'WORKING':uiReady&&modelReady?'READY':'STALLED';
  return {
    uiReady,uiPhase,composerReady:Boolean(composer),sendReady:Boolean(send),stopVisible:Boolean(stop),activityBusyVisible:Boolean(activityBusy),
    scrollToBottomVisible:Boolean(scroll),authRequired,uiBusy,securityBlock,chatLoadError,chatRetryReady:Boolean(chatRetry),
    modelControlPresent:Boolean(modelControl),modelProfileStatus,modelName,reasoningEffort,modelReady,modelExact,verifiedAt,blockedReason,activitySignature,projectDraftReady,
    title:document.title,url:location.href,readyState:document.readyState,bodyChildren:document.body?.children?.length||0
  };
})()`;

async function uiStateRaw(target){
  const p=await pageRpc(target);
  try{return (await p.call('Runtime.evaluate',{expression:UI_EXPR,returnByValue:true})).result.value;}
  finally{p.close();}
}
async function uiState(target){
  const raw=await uiStateRaw(target);
  return applyNv02DurableVerifiedModelProfile(applyNv02VerifiedModelProfile(raw));
}
async function evalPage(target,expression){
  const p=await pageRpc(target);
  try{return (await p.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;}
  finally{p.close();}
}
function chatLoadRetryExpr(){
  return `(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const b=[...document.querySelectorAll('button,[role="button"]')].find(e=>vis(e)&&/^(retry|thử lại)$/i.test((e.innerText||e.textContent||e.getAttribute('aria-label')||'').trim()));if(!b)return{ok:false,status:'CHAT_LOAD_RETRY_NOT_FOUND'};b.click();return{ok:true,status:'CHAT_LOAD_RETRY_CLICKED'}})()`;
}
function loadContinuityFor(w){return w.id==='NV02'?loadNv02Continuity():loadWorkerContinuity(w.id);}
function saveContinuityFor(w,state){if(w.id==='NV02')saveNv02Continuity(state);else saveWorkerContinuity(w.id,state);}
async function continuityEventFor(w,event,data={}){if(w.id==='NV02')await continuityEvent(event,data);else await genericWorkerEvent(w.id,event,data);}
async function withWorkerUiMutation(w,fn,purpose,ttlMs=30000){
  return w.id==='NV02'?withNv02Mutation(fn,purpose,ttlMs):withWorkerMutation(w.id,fn,purpose,ttlMs);
}
async function clearChatLoadRecovery(w,state,event,data={}){
  const clean={...state,chatLoadRecoveryStage:0,chatLoadBlockedUntil:0,chatLoadClearCandidateAt:0};
  saveContinuityFor(w,clean);
  await continuityEventFor(w,event,data);
  return clean;
}
function chatLoadStableUi(ui){
  return Boolean(ui&&!ui.chatLoadError&&!ui.authRequired&&!ui.securityBlock&&(ui.uiBusy===true||ui.composerReady===true));
}
async function maybeRecoverChatLoadError(w,target,ui,now=Date.now()){
  let state=loadContinuityFor(w);
  if(!ui?.chatLoadError){
    const recoveryActive=Number(state.chatLoadRecoveryStage||0)>0||Number(state.chatLoadBlockedUntil||0)>0||Number(state.chatLoadClearCandidateAt||0)>0;
    if(!recoveryActive)return false;
    if(!chatLoadStableUi(ui)){
      if(Number(state.chatLoadClearCandidateAt||0)>0){
        state={...state,chatLoadClearCandidateAt:0};
        saveContinuityFor(w,state);
      }
      await continuityEventFor(w,'CHAT_LOAD_RECOVERY_WAITING_STABLE_UI',{url:ui?.url||null,phase:ui?.uiPhase||null});
      return true;
    }
    const candidateAt=Number(state.chatLoadClearCandidateAt||0);
    if(!candidateAt){
      state={...state,chatLoadClearCandidateAt:now};
      saveContinuityFor(w,state);
      await continuityEventFor(w,'CHAT_LOAD_RECOVERY_STABLE_CANDIDATE',{url:ui?.url||null});
      return true;
    }
    if(now-candidateAt<5000)return true;
    await clearChatLoadRecovery(w,state,'CHAT_LOAD_RECOVERED_STABLE',{url:ui?.url||null,stableMs:now-candidateAt});
    return false;
  }
  if(Number(state.chatLoadClearCandidateAt||0)>0){
    state={...state,chatLoadClearCandidateAt:0};
    saveContinuityFor(w,state);
  }
  if(now<Number(state.chatLoadBlockedUntil||0)){
    await continuityEventFor(w,'CHAT_UNLOADABLE_BACKOFF',{url:ui?.url||null,blockedUntil:state.chatLoadBlockedUntil});
    return true;
  }
  const stage=Number(state.chatLoadRecoveryStage||0);
  if(stage===0){
    const result=await withWorkerUiMutation(w,()=>evalPage(target,chatLoadRetryExpr()),'CHAT_LOAD_RETRY',15000);
    await sleep(2200);
    const after=await uiStateRaw(target).catch(()=>null);
    if(chatLoadStableUi(after)){
      const candidate={...state,chatLoadRecoveryStage:1,chatLoadClearCandidateAt:Date.now()};
      saveContinuityFor(w,candidate);
      await continuityEventFor(w,'CHAT_LOAD_RETRY_STABLE_CANDIDATE',{url:after?.url||null});
      return true;
    }
    state={...state,chatLoadRecoveryStage:1};
    saveContinuityFor(w,state);
    await continuityEventFor(w,'CHAT_LOAD_RETRY_EXHAUSTED',{status:result?.status||null,url:ui?.url||null});
    return true;
  }
  if(stage===1){
    const result=await withWorkerUiMutation(w,()=>reloadTarget(target),'CHAT_LOAD_F5',20000);
    await sleep(2500);
    const after=await uiStateRaw(target).catch(()=>null);
    if(chatLoadStableUi(after)){
      const candidate={...state,chatLoadRecoveryStage:2,chatLoadClearCandidateAt:Date.now()};
      saveContinuityFor(w,candidate);
      await continuityEventFor(w,'CHAT_LOAD_F5_STABLE_CANDIDATE',{url:after?.url||null});
      return true;
    }
    state={...state,chatLoadRecoveryStage:2};
    saveContinuityFor(w,state);
    await continuityEventFor(w,'CHAT_LOAD_F5_EXHAUSTED',{status:result?.status||null,url:ui?.url||null});
    return true;
  }
  if(stage===2){
    state={...state,chatLoadRecoveryStage:3};
    saveContinuityFor(w,state);
    if(w.id==='NV02'){
      await continuityEventFor(w,'CHAT_LOAD_TERMINAL_FAILURE_REACHED',{url:ui?.url||null});
      const hasWork=hasCurrentNv02Chat(ui?.url);
      if(hasWork) return false;
    }else{
      await reopenWorker(w,target,state,now,'CHAT_LOAD_ERROR');
    }
    await continuityEventFor(w,'CHAT_LOAD_REOPEN_REQUESTED',{url:ui?.url||null});
    return true;
  }
  const blockedUntil=now+15*60*1000;
  state={...state,chatLoadRecoveryStage:0,chatLoadBlockedUntil:blockedUntil};
  saveContinuityFor(w,state);
  await continuityEventFor(w,'CHAT_UNLOADABLE_BLOCKED',{url:ui?.url||null,blockedUntil});
  return true;
}
const MODEL_SELECTOR_CLICK_EXPR=`(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const controls=[...document.querySelectorAll('button,[role="button"]')].filter(e=>vis(e)&&(e.hasAttribute('data-selected-reasoning-effort')||/chọn mô hình chatgpt|choose.*model|model selector/i.test((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||''))));if(controls.length!==1)return{ok:false,status:'MODEL_CONTROL_NOT_EXACT_OR_UNIQUE',count:controls.length};controls[0].click();return{ok:true,status:'MODEL_SELECTOR_OPENED'}})()`;
const MODEL_56_SOL_CLICK_EXPR=`(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const text=e=>String(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim();const opts=[...document.querySelectorAll('button,[role="menuitem"],[role="menuitemradio"],[role="option"]')].filter(e=>vis(e)&&/^(?:GPT-)?5\\.6\\s+Sol(?:\\s|$)/i.test(text(e)));if(opts.length!==1)return{ok:false,status:'GPT_5_6_SOL_OPTION_NOT_UNIQUE',count:opts.length,labels:opts.slice(0,5).map(text)};opts[0].click();return{ok:true,status:'GPT_5_6_SOL_SELECTED'}})()`;
const REASONING_HIGH_CLICK_EXPR=`(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const text=e=>String(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim();const opts=[...document.querySelectorAll('button,[role="menuitem"],[role="menuitemradio"],[role="option"]')].filter(e=>vis(e)&&/^(?:High|Cao)(?:\\s|$)/i.test(text(e)));if(opts.length!==1)return{ok:false,status:'REASONING_HIGH_OPTION_NOT_UNIQUE',count:opts.length,labels:opts.slice(0,5).map(text)};opts[0].click();return{ok:true,status:'REASONING_HIGH_SELECTED'}})()`;
const MODEL_SELECTED_EXPR=`(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const text=e=>String(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim();const checked=[...document.querySelectorAll('[role="menuitemradio"][aria-checked="true"],[role="option"][aria-selected="true"]')].filter(vis);const labels=checked.map(text);const exact=labels.filter(x=>/^(?:GPT-)?5\\.6\\s+Sol$/i.test(x));return{ok:exact.length===1,modelName:exact.length===1?'GPT-5.6 Sol':null,checkedLabels:labels.slice(0,10)}})()`;
const MODEL_MENU_DISMISS_EXPR=`(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));return{ok:true}})()`;
async function inspectNv02SelectedModel(target){
  const raw=await uiStateRaw(target);
  if(raw?.securityBlock)throw new Error(raw.securityBlock);
  const opened=await evalPage(target,MODEL_SELECTOR_CLICK_EXPR);
  if(!opened?.ok)throw new Error(opened?.status||'MODEL_SELECTOR_OPEN_FAILED');
  await sleep(400);
  const selected=await evalPage(target,MODEL_SELECTED_EXPR);
  await evalPage(target,MODEL_MENU_DISMISS_EXPR).catch(()=>{});
  const after=await uiStateRaw(target);
  const modelName=selected?.modelName||null;
  const reasoningEffort=after?.reasoningEffort||null;
  const exact=modelName==='GPT-5.6 Sol'&&reasoningEffort==='High';
  if(exact)nv02VerifiedModelProfile={url:after.url,verifiedAt:new Date().toISOString()};
  else if(nv02VerifiedModelProfile?.url===after?.url)nv02VerifiedModelProfile=null;
  return exact
    ? applyNv02VerifiedModelProfile({...after,modelName,reasoningEffort})
    : {...after,modelName,modelProfileStatus:'MODEL_PROFILE_BLOCKED',modelReady:false,modelExact:false,verifiedAt:null,blockedReason:modelName!=='GPT-5.6 Sol'?'MODEL_NAME_NOT_GPT_5_6_SOL':'REASONING_NOT_HIGH'};
}
async function ensureNv02ModelProfile(target){
  let profile=await inspectNv02SelectedModel(target);
  const maxAttempts=3;
  for(let i=0;i<maxAttempts;i++){
    if(profile?.modelExact===true&&profile?.modelName==='GPT-5.6 Sol'&&profile?.reasoningEffort==='High')break;
    if(profile?.modelName!=='GPT-5.6 Sol'){
      const opened=await evalPage(target,MODEL_SELECTOR_CLICK_EXPR);
      if(!opened?.ok)throw new Error(opened?.status||'MODEL_SELECTOR_OPEN_FAILED');
      await sleep(400);
      const modelSelected=await evalPage(target,MODEL_56_SOL_CLICK_EXPR);
      if(!modelSelected?.ok)throw new Error(modelSelected?.status||'GPT_5_6_SOL_SELECT_FAILED');
      await sleep(650);
      profile=await inspectNv02SelectedModel(target);
    }
    if(profile?.modelName==='GPT-5.6 Sol'&&profile?.reasoningEffort!=='High'){
      const reasoningOpened=await evalPage(target,MODEL_SELECTOR_CLICK_EXPR);
      if(!reasoningOpened?.ok)throw new Error(reasoningOpened?.status||'REASONING_SELECTOR_OPEN_FAILED');
      await sleep(400);
      const reasoningSelected=await evalPage(target,REASONING_HIGH_CLICK_EXPR);
      if(!reasoningSelected?.ok)throw new Error(reasoningSelected?.status||'REASONING_HIGH_SELECT_FAILED');
      await sleep(650);
      profile=await inspectNv02SelectedModel(target);
    }
  }
  if(profile?.modelExact!==true||profile?.modelName!=='GPT-5.6 Sol'||profile?.reasoningEffort!=='High')throw new Error('MODEL_PROFILE_MISMATCH');
  const state=loadNv02Continuity();
  const currentUrl=String(profile.url||'');
  saveNv02Continuity({...state,verifiedChatUrl:currentUrl,resumeChatUrl:hasCurrentNv02Chat(currentUrl)?currentUrl:state.resumeChatUrl,modelVerifiedAt:String(profile.verifiedAt||new Date().toISOString())});
  await continuityEvent('MODEL_PROFILE_VERIFIED',{modelName:profile.modelName,reasoningEffort:profile.reasoningEffort,verifiedAt:profile.verifiedAt||null});
  return profile;
}
async function post(path,workerId,data,timeoutMs=4000){
  const r=await fetch(CONTROLLER+path,{method:'POST',headers:auth(workerId,true),body:JSON.stringify(data),signal:AbortSignal.timeout(timeoutMs)});
  if(!r.ok) throw new Error(`HTTP_${r.status}:${path}`);return r.json();
}
async function getCommand(workerId){
  const r=await fetch(`${CONTROLLER}/api/commands/${encodeURIComponent(workerId)}`,{headers:auth(workerId),signal:AbortSignal.timeout(4000)});
  if(!r.ok) throw new Error(`HTTP_${r.status}:commands`);return (await r.json()).command||null;
}
async function getControllerState(){
  const r=await fetch(CONTROLLER+'/api/state',{headers:auth('NV02'),signal:AbortSignal.timeout(4000)});
  if(!r.ok)throw new Error(`HTTP_${r.status}:state`);
  return r.json();
}
async function continuityEvent(event,data={}){
  try{await post('/api/continuity/event','NV02',{workerId:'NV02',event,...data});}
  catch(error){log('NV02_CONTINUITY_EVENT_POST_FAILED',{event,error:String(error?.message||error)});}
}

async function acquireBridgeMutationLease(workerId,purpose='NORMAL',ttlMs=30000){
  const ownerId=`DIRECT_CDP_BRIDGE:${process.pid}:${workerId}`;
  const r=await fetch(`${CONTROLLER}/api/utility/workers/${workerId}/mutation-lease/acquire`,{
    method:'POST',headers:auth(workerId,true),body:JSON.stringify({ownerId,ttlMs,purpose}),signal:AbortSignal.timeout(4000)
  });
  if(r.status===409){
    const data=await r.json().catch(()=>({}));
    const error=String(data?.error||'');
    if(error.startsWith('BROWSER_MUTATION_LEASE_BUSY:'))return null;
    throw new Error(error||`HTTP_409:mutation-lease-acquire`);
  }
  if(!r.ok)throw new Error(`HTTP_${r.status}:mutation-lease-acquire`);
  const data=await r.json();return data.lease?{ownerId,leaseId:data.lease.leaseId}:null;
}
async function releaseBridgeMutationLease(workerId,lease){
  if(!lease)return;
  await fetch(`${CONTROLLER}/api/utility/workers/${workerId}/mutation-lease/release`,{
    method:'POST',headers:auth(workerId,true),body:JSON.stringify(lease),signal:AbortSignal.timeout(4000)
  }).catch(()=>{});
}
async function externalAutopilotOwnsNextNv02Job(){
  try{
    const stateResponse=await fetch(`${CONTROLLER}/api/state`,{signal:AbortSignal.timeout(2500)});
    if(!stateResponse.ok)return false;
    const state=await stateResponse.json();
    if(state?.externalWorkAutopilotEnabled!==true||state?.ownerInteractionMode==='READ_ONLY')return false;
    const autoResponse=await fetch(`${CONTROLLER}/api/autopilot/state`,{signal:AbortSignal.timeout(2500)});
    if(!autoResponse.ok)return false;
    const auto=await autoResponse.json();
    const next=auto?.snapshot?.nextJob;
    return Boolean(next&&next.workerId==='NV02'&&next.executable===true&&['QUEUED','READY'].includes(String(next.status||'')));
  }catch{return false;}
}
async function navigate(target,url){
  const p=await pageRpc(target);try{await p.call('Page.enable');await p.call('Page.navigate',{url});}finally{p.close();}
}
function projectNewChatExpr(){
  return `(()=>{const labels=['Trò chuyện mới trong TigerIQ AI Lab','New chat in TigerIQ AI Lab'];const matches=[...document.querySelectorAll('button,[role="button"]')].filter(e=>labels.includes((e.getAttribute('aria-label')||'').trim()));if(matches.length!==1)return{ok:false,status:'PROJECT_NEW_CHAT_BUTTON_COUNT_'+matches.length};matches[0].click();return{ok:true,status:'PROJECT_NEW_CHAT_CLICKED'}})()`;
}
async function recoverNv02ProjectContext(target){
  const state=loadNv02Continuity();
  if(hasCurrentNv02Chat(state.resumeChatUrl)){
    await navigate(target,state.resumeChatUrl);
    await sleep(1200);
    return{ok:true,status:'CURRENT_CHAT_RESTORED',url:state.resumeChatUrl};
  }
  for(let attempt=0;attempt<12;attempt+=1){
    const p=await pageRpc(target);
    try{
      const clicked=(await p.call('Runtime.evaluate',{expression:projectNewChatExpr(),returnByValue:true,userGesture:true})).result.value;
      if(clicked?.ok)return clicked;
    }finally{p.close();}
    await sleep(250);
  }
  await navigate(target,NV02_HOME_URL);
  return{ok:true,status:'PROJECT_CONTEXT_NAVIGATED'};
}
async function focus(target){const p=await pageRpc(target);try{await p.call('Page.bringToFront');}finally{p.close();}}
async function layout(w,target,bounds){
  const port=workerPort(w),b=await browserRpc(port);
  try{const {windowId}=await b.call('Browser.getWindowForTarget',{targetId:target.id});await b.call('Browser.setWindowBounds',{windowId,bounds:{left:Number(bounds.left),top:Number(bounds.top),width:Number(bounds.width),height:Number(bounds.height),windowState:'normal'}});}
  finally{b.close();}
}
async function closeWorker(w,target){
  const port=workerPort(w),windowId=await windowIdFor(port,target.id);
  await post('/api/window-event',w.id,{workerId:w.id,event:'CLOSED',windowId});
  const b=await browserRpc(port);try{await b.call('Browser.close',{}).catch(()=>{});}finally{b.close();}
}
function dispatchExpr(text){
  return `(async()=>{const text=${JSON.stringify(text)},expected=text.trim();const sleep=ms=>new Promise(r=>setTimeout(r,ms));const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const securityBlock=()=>{if(document.querySelector('iframe[src*=\"captcha\" i],iframe[src*=\"challenge\" i],[class*=\"captcha\" i],[id*=\"captcha\" i]'))return'BLOCKED_CAPTCHA';const t=[...document.querySelectorAll('[role=\"alert\"],[role=\"dialog\"],[data-testid*=\"toast\" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' '),m=[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']];for(const [n,s] of m)if(t.includes(n))return s;return null;};const blocked=securityBlock();if(blocked)return{ok:false,status:blocked};if(!expected)return{ok:false,status:'EMPTY_WORK_ORDER'};const sels=location.hostname==='chatgpt.com'?['#prompt-textarea','div[contenteditable=\"true\"][data-lexical-editor=\"true\"]','[contenteditable=\"true\"][role=\"textbox\"]','textarea']:['rich-textarea .ql-editor[contenteditable=\"true\"]','.ql-editor[contenteditable=\"true\"]','[contenteditable=\"true\"][role=\"textbox\"]','textarea'];const findComposer=()=>{for(const s of sels){const x=[...document.querySelectorAll(s)].find(vis);if(x)return x;}return null;};const composerText=e=>e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement?String(e.value||'').trim():String(e?.innerText||e?.textContent||'').trim();let c=findComposer();if(!c)return{ok:false,status:'COMPOSER_NOT_FOUND'};if(composerText(c)!==expected){c.focus();if(c instanceof HTMLTextAreaElement||c instanceof HTMLInputElement){const proto=c instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(c,text);c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));}else{const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(c);sel?.removeAllRanges();sel?.addRange(range);if(!document.execCommand('insertText',false,text)){c.textContent=text;c.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));}}}const scoped=['button[data-testid=\"send-button\"]','button[data-testid=\"composer-submit-button\"]','button[type=\"submit\"]','button[aria-label*=\"Send\" i]','button[aria-label*=\"Gửi\" i]','button[aria-label*=\"submit\" i]'],global=['button[data-testid=\"send-button\"]','button[data-testid=\"composer-submit-button\"]','button[aria-label*=\"Send\" i]','button[aria-label*=\"Gửi\" i]','button[aria-label*=\"submit\" i]'];const usable=e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';const findSend=()=>{for(const root of [c.closest?.('form'),c.parentElement].filter(Boolean))for(const s of scoped){const a=[...root.querySelectorAll(s)].filter(usable);if(a.length===1)return a[0];}for(const s of global){const a=[...document.querySelectorAll(s)].filter(usable);if(a.length===1)return a[0];}return null;};let b=null,until=Date.now()+${SEND_BUTTON_WAIT_MS};while(Date.now()<until){await sleep(150);const gate=securityBlock();if(gate)return{ok:false,status:gate};b=findSend();if(b)break;}if(!b)return{ok:false,status:'SEND_BUTTON_NOT_FOUND'};b.click();const busy=()=>['button[data-testid=\"stop-button\"]','button[aria-label*=\"Stop\" i]','button[aria-label*=\"Dừng\" i]','button[aria-label*=\"Ngừng\" i]'].some(s=>[...document.querySelectorAll(s)].some(vis))||[...document.querySelectorAll('button,[role=\"button\"],[aria-live]')].some(e=>vis(e)&&/(^|\\s)(đang suy nghĩ|thinking|generating|đang tạo)(\\s|$)/i.test((e.getAttribute('aria-label')||e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()));until=Date.now()+3500;while(Date.now()<until){await sleep(100);const gate=securityBlock();if(gate)return{ok:false,status:gate};if(busy())return{ok:true,status:'SUBMITTED',evidence:'UI_BUSY'};if(location.hostname==='chatgpt.com'){const expectedNormalized=expected.replace(/\\s+/g,' ').trim();const userSelector='[data-message-author-role=\"user\"],.rich-text-user-turn,[data-user-message-bubble=\"true\"] .rich-text-user-turn,[data-content-search-unit-key$=\":user\"]';if([...document.querySelectorAll(userSelector)].some(e=>vis(e)&&String(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()===expectedNormalized))return{ok:true,status:'SUBMITTED',evidence:'USER_MESSAGE_VISIBLE'};}c=findComposer();if(c&&composerText(c)==='')return{ok:true,status:'SUBMITTED',evidence:'COMPOSER_CLEARED'};}return{ok:false,status:'SUBMIT_EVIDENCE_MISSING'};})()`;
}
function enterSubmitStateExpr(text){
  const expectedNormalized=String(text||'').replace(/\\s+/g,' ').trim();
  return `(()=>{const expected=${JSON.stringify(text.trim())},expectedNormalized=${JSON.stringify(expectedNormalized)};const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const securityBlock=()=>{if(document.querySelector('iframe[src*="captcha" i],iframe[src*="challenge" i],[class*="captcha" i],[id*="captcha" i]'))return'BLOCKED_CAPTCHA';const t=[...document.querySelectorAll('[role="alert"],[role="dialog"],[data-testid*="toast" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' '),m=[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']];for(const [n,x] of m)if(t.includes(n))return x;return null;};const sels=['#prompt-textarea','div[contenteditable="true"][data-lexical-editor="true"]','[contenteditable="true"][role="textbox"]','textarea'];const c=sels.flatMap(x=>[...document.querySelectorAll(x)]).find(vis)||null;const composerText=e=>e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement?String(e.value||'').trim():String(e?.innerText||e?.textContent||'').trim();const busy=['button[data-testid="stop-button"]','button[aria-label*="Stop" i]','button[aria-label*="Dừng" i],button[aria-label*="Ngừng" i]'].some(x=>[...document.querySelectorAll(x)].some(vis))||[...document.querySelectorAll('button,[role="button"],[aria-live]')].some(e=>vis(e)&&/(^|\\s)(đang suy nghĩ|thinking|generating|đang tạo)(\\s|$)/i.test((e.getAttribute('aria-label')||e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()));const userSelector='[data-message-author-role="user"],.rich-text-user-turn,[data-user-message-bubble="true"] .rich-text-user-turn,[data-content-search-unit-key$=":user"]';const userVisible=[...document.querySelectorAll(userSelector)].some(e=>vis(e)&&String(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()===expectedNormalized);const current=composerText(c),currentNormalized=current.replace(/\\s+/g,' ').trim();return{securityBlock:securityBlock(),composerMatches:Boolean(c)&&currentNormalized===expectedNormalized,composerEmpty:Boolean(c)&&current==='',busy,userVisible};})()`;
}
function focusComposerExpr(){
  return `(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const sels=['#prompt-textarea','div[contenteditable="true"][data-lexical-editor="true"]','[contenteditable="true"][role="textbox"]','textarea'];const c=sels.flatMap(x=>[...document.querySelectorAll(x)]).find(vis)||null;if(!c)return{ok:false,status:'COMPOSER_NOT_FOUND'};c.focus();return{ok:true,status:'COMPOSER_FOCUSED'}})()`;
}
async function rewriteComposerViaCdp(p,text){
  const focused=(await p.call('Runtime.evaluate',{expression:focusComposerExpr(),returnByValue:true,userGesture:true},3000)).result.value;
  if(!focused?.ok)return focused||{ok:false,status:'COMPOSER_NOT_FOUND'};
  await p.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,nativeVirtualKeyCode:17,modifiers:2});
  await p.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65,modifiers:2});
  await p.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65,modifiers:2});
  await p.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,nativeVirtualKeyCode:17});
  await p.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
  await p.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
  await p.call('Input.insertText',{text});
  const verify=(await p.call('Runtime.evaluate',{expression:enterSubmitStateExpr(text),returnByValue:true,userGesture:true},3000)).result.value;
  if(verify?.securityBlock)return{ok:false,status:verify.securityBlock};
  if(verify?.composerMatches!==true)return{ok:false,status:'CDP_TEXT_INSERT_EVIDENCE_MISSING'};
  return{ok:true,status:'CDP_TEXT_INSERT_VERIFIED'};
}
async function dispatch(target,text){
  const p=await pageRpc(target);
  try{
    const pacingMs=await stabilityPace();
    log('UI_STABILITY_PACING',{action:'DISPATCH',delayMs:pacingMs});
    const first=(await p.call('Runtime.evaluate',{expression:dispatchExpr(text),awaitPromise:true,returnByValue:true,userGesture:true},SEND_BUTTON_WAIT_MS+6000)).result.value;
    if(first?.status!=='SEND_BUTTON_NOT_FOUND')return first;
    let before=(await p.call('Runtime.evaluate',{expression:enterSubmitStateExpr(text),returnByValue:true,userGesture:true},3000)).result.value;
    if(before?.securityBlock)return{ok:false,status:before.securityBlock};
    if(before?.userVisible)return{ok:true,status:'SUBMITTED',evidence:'USER_MESSAGE_VISIBLE_BEFORE_ENTER'};
    if(before?.composerMatches!==true){
      const rewritten=await rewriteComposerViaCdp(p,text);
      if(!rewritten?.ok)return rewritten;
      before=(await p.call('Runtime.evaluate',{expression:enterSubmitStateExpr(text),returnByValue:true,userGesture:true},3000)).result.value;
      if(before?.securityBlock)return{ok:false,status:before.securityBlock};
      if(before?.composerMatches!==true)return{ok:false,status:'CDP_TEXT_INSERT_EVIDENCE_MISSING'};
    }
    await p.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
    await p.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
    const deadline=Date.now()+3500;
    while(Date.now()<deadline){
      await sleep(100);
      const after=(await p.call('Runtime.evaluate',{expression:enterSubmitStateExpr(text),returnByValue:true},3000)).result.value;
      if(after?.securityBlock)return{ok:false,status:after.securityBlock};
      if(after?.busy)return{ok:true,status:'SUBMITTED',evidence:'ENTER_UI_BUSY'};
      if(after?.userVisible)return{ok:true,status:'SUBMITTED',evidence:'ENTER_USER_MESSAGE_VISIBLE'};
    }
    return{ok:false,status:'ENTER_SUBMIT_EVIDENCE_MISSING'};
  }finally{p.close();}
}
function scrollBottomExpr(){return `(()=>{const vis=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const b=[...document.querySelectorAll('button,[role="button"]')].find(e=>vis(e)&&/^(cuộn xuống cuối|scroll to bottom|jump to bottom)$/i.test((e.getAttribute('aria-label')||e.textContent||'').trim()));if(!b)return{ok:true,status:'ALREADY_AT_BOTTOM'};b.click();return{ok:true,status:'SCROLL_TO_BOTTOM_CLICKED'}})()`; }
async function scrollToBottom(target){const p=await pageRpc(target);try{const pacingMs=await stabilityPace();const result=(await p.call('Runtime.evaluate',{expression:scrollBottomExpr(),returnByValue:true,userGesture:true})).result.value;log('UI_STABILITY_PACING',{action:'SCROLL_TO_BOTTOM',delayMs:pacingMs,status:result?.status||null});return{...(result||{}),pacingMs};}finally{p.close();}}

function stopStalledWorkingExpr(){return `(()=>{const vis=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const buttons=[...document.querySelectorAll('button[data-testid="stop-button"],button[aria-label*="Stop" i],button[aria-label*="Dừng" i],button[aria-label*="Ngừng" i]')].filter(vis);if(buttons.length!==1)return{ok:false,status:'WORKING_STALLED_STOP_BUTTON_COUNT_'+buttons.length};buttons[0].click();return{ok:true,status:'WORKING_STALLED_STOP_CLICKED'}})()`;}
async function stopStalledWorking(target){
  const p=await pageRpc(target);
  let clicked;
  try{clicked=(await p.call('Runtime.evaluate',{expression:stopStalledWorkingExpr(),returnByValue:true,userGesture:true},5000)).result.value;}
  finally{p.close();}
  if(!clicked?.ok){
    const after=await uiState(target).catch(()=>null);
    if(after&&after.uiBusy!==true&&after.stopVisible!==true)return{ok:true,status:'WORKING_RECOVERED_BEFORE_STOP',afterPhase:after.uiPhase||null,afterUrl:after.url||null,afterSignature:String(after.activitySignature||'')};
    return clicked||{ok:false,status:'WORKING_STALLED_STOP_FAILED'};
  }
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    await sleep(500);
    const after=await uiState(target).catch(()=>null);
    if(after&&after.uiBusy!==true&&after.stopVisible!==true)return{ok:true,status:'WORKING_STALLED_STOPPED',afterPhase:after.uiPhase||null,afterUrl:after.url||null,afterSignature:String(after.activitySignature||'')};
  }
  return{ok:false,status:'WORKING_STALLED_STOP_TIMEOUT'};
}

function archiveMenuPointExpr(){return `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const vis=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};if(!/\\/c\\//.test(location.pathname))return{ok:false,status:'ARCHIVE_REQUIRES_CONVERSATION_URL'};const before=location.href,title=document.title.trim(),conversationId=(location.pathname.match(/\\/c\\/([^/?#]+)/)||[])[1]||'';const open=[...document.querySelectorAll('button,[role="button"]')].find(e=>vis(e)&&/mở sidebar|hiện thanh bên|open sidebar/i.test((e.getAttribute('aria-label')||e.innerText||'').trim()));if(open){open.click();await sleep(450)}const rows=[...document.querySelectorAll('[role="listitem"]')].filter(vis);const matchesConversation=row=>Boolean(conversationId)&&(row.getAttribute('data-pinned-content-tab-drop-key')===('chatgpt:conversation:'+conversationId)||row.querySelector('[data-pinned-content-tab-drop-key="chatgpt:conversation:'+conversationId+'"]')||row.querySelector('a[href*="/c/'+conversationId+'"]')||row.querySelector('[data-app-action-sidebar-thread-id="'+conversationId+'"]'));const identityRows=conversationId?rows.filter(matchesConversation):[];const candidates=identityRows.length?identityRows:rows.filter(row=>String(row.innerText||'').trim()===title);const exact=candidates.filter(row=>[...row.querySelectorAll('button')].some(b=>/hành động trong trò chuyện|conversation actions|chat actions/i.test(b.getAttribute('aria-label')||'')));if(exact.length!==1)return{ok:false,status:'ARCHIVE_CURRENT_ROW_COUNT_'+exact.length,title,conversationId,identityMatches:identityRows.length};const menu=[...exact[0].querySelectorAll('button')].filter(b=>vis(b)&&/hành động trong trò chuyện|conversation actions|chat actions/i.test(b.getAttribute('aria-label')||''));if(menu.length!==1)return{ok:false,status:'ARCHIVE_MENU_BUTTON_COUNT_'+menu.length,title};const r=menu[0].getBoundingClientRect();return{ok:true,status:'ARCHIVE_MENU_POINT',before,title,conversationId,x:r.left+r.width/2,y:r.top+r.height/2}})()`; }
function archiveItemPointExpr(){return `(()=>{const vis=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const items=[...document.querySelectorAll('[role="menuitem"]')].filter(vis).filter(e=>/^(archive|lưu trữ)$/i.test((e.innerText||e.textContent||e.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim()));if(items.length!==1)return{ok:false,status:'ARCHIVE_ACTION_COUNT_'+items.length};const r=items[0].getBoundingClientRect();return{ok:true,status:'ARCHIVE_ACTION_POINT',x:r.left+r.width/2,y:r.top+r.height/2,text:(items[0].innerText||items[0].textContent||'').trim()}})()`; }
async function cdpMouseClick(p,point){
  const pacingMs=await stabilityPace();
  log('UI_STABILITY_PACING',{action:'MOUSE_CLICK',delayMs:pacingMs});
  await p.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:Number(point.x),y:Number(point.y),button:'none'});
  await p.call('Input.dispatchMouseEvent',{type:'mousePressed',x:Number(point.x),y:Number(point.y),button:'left',clickCount:1});
  await p.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:Number(point.x),y:Number(point.y),button:'left',clickCount:1});
}
function archiveConfirmExpr(title,conversationId){
  const expected=JSON.stringify(String(title||'')),expectedConversation=JSON.stringify(String(conversationId||''));
  return `(()=>{const vis=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const conversationId=${expectedConversation};const rows=[...document.querySelectorAll('[role="listitem"]')].filter(e=>vis(e)&&[...e.querySelectorAll('button')].some(b=>/hành động trong trò chuyện|conversation actions|chat actions/i.test(b.getAttribute('aria-label')||'')));const matchesConversation=row=>Boolean(conversationId)&&(row.getAttribute('data-pinned-content-tab-drop-key')===('chatgpt:conversation:'+conversationId)||row.querySelector('[data-pinned-content-tab-drop-key="chatgpt:conversation:'+conversationId+'"]')||row.querySelector('a[href*="/c/'+conversationId+'"]')||row.querySelector('[data-app-action-sidebar-thread-id="'+conversationId+'"]'));const current=conversationId?rows.filter(matchesConversation):rows.filter(row=>String(row.innerText||'').trim()===${expected});return{url:location.href,path:location.pathname,visibleChatRows:rows.length,currentIdentityRows:current.length,currentTitleRows:current.length,conversationId}})()`;
}
async function archiveChat(target){
  const p=await pageRpc(target);
  try{
    const menuPoint=(await p.call('Runtime.evaluate',{expression:archiveMenuPointExpr(),awaitPromise:true,returnByValue:true,userGesture:true},10000)).result.value;
    if(!menuPoint?.ok)return menuPoint||{ok:false,status:'ARCHIVE_MENU_POINT_MISSING'};
    await cdpMouseClick(p,menuPoint);
    let archivePoint=null;
    const actionDeadline=Date.now()+4000;
    while(Date.now()<actionDeadline){
      await sleep(200);
      archivePoint=(await p.call('Runtime.evaluate',{expression:archiveItemPointExpr(),returnByValue:true},3000)).result.value;
      if(archivePoint?.ok)break;
    }
    if(!archivePoint?.ok){
      await p.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}).catch(()=>{});
      await p.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}).catch(()=>{});
      return archivePoint||{ok:false,status:'ARCHIVE_ACTION_POINT_MISSING'};
    }
    await cdpMouseClick(p,archivePoint);
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      await sleep(250);
      const state=(await p.call('Runtime.evaluate',{expression:archiveConfirmExpr(menuPoint.title,menuPoint.conversationId),returnByValue:true},3000)).result.value;
      const sidebarRemoved=Number(state?.visibleChatRows||0)>0&&Number(state?.currentTitleRows||0)===0;
      if(state?.url!==menuPoint.before||!/\/c\//.test(String(state?.path||''))||sidebarRemoved)return{ok:true,status:'ARCHIVED',before:menuPoint.before,after:state?.url||null,title:menuPoint.title,actionText:archivePoint.text,confirmation:sidebarRemoved?'SIDEBAR_ROW_REMOVED':'NAVIGATION'};
    }
    return{ok:false,status:'ARCHIVE_NOT_CONFIRMED',before:menuPoint.before,title:menuPoint.title};
  }finally{p.close();}
}

function newChatExpr(){return `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const vis=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const before=location.href;const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(e=>vis(e)&&/trò chuyện mới|đoạn chat mới|new chat/i.test((e.getAttribute('aria-label')||e.innerText||'').trim()));const preferred=buttons.find(e=>/trong tigeriq ai lab/i.test((e.getAttribute('aria-label')||'').trim()))||buttons[0];if(!preferred)return{ok:false,status:'NEW_CHAT_BUTTON_NOT_FOUND'};preferred.click();for(let i=0;i<40;i++){await sleep(250);const c=[...document.querySelectorAll('#prompt-textarea,[contenteditable="true"][role="textbox"],textarea')].find(vis);if(c&&(!/\\/c\\//.test(location.pathname)||location.href!==before))return{ok:true,status:'NEW_CHAT_READY',url:location.href}}return{ok:false,status:'NEW_CHAT_NOT_CONFIRMED',url:location.href}})()`; }
function newChatContextExpr(){
  return `(()=>{const v=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const composer=Boolean([...document.querySelectorAll('#prompt-textarea,[contenteditable="true"][role="textbox"],textarea')].find(v));const projectDraftLabels=['thay đổi dự án: tigeriq ai lab','change project: tigeriq ai lab'];const projectDraftReady=[...document.querySelectorAll('button,[role="button"]')].some(e=>v(e)&&projectDraftLabels.includes((e.getAttribute('aria-label')||'').trim().toLowerCase()));return{url:location.href,pathname:location.pathname,composer,projectDraftReady}})()`;
}
async function newChat(target){
  const p=await pageRpc(target);
  try{
    const first=(await p.call('Runtime.evaluate',{expression:newChatExpr(),awaitPromise:true,returnByValue:true,userGesture:true},12000)).result.value;
    if(!first?.ok)return first;
    if(!NV02_HOME_URL)return{ok:false,status:'NV02_HOME_URL_MISSING'};
    const expected=new URL(NV02_HOME_URL);
    const current=(await p.call('Runtime.evaluate',{expression:newChatContextExpr(),returnByValue:true},3000)).result.value;
    if(current?.composer&&current?.projectDraftReady===true)return{ok:true,status:'NEW_CHAT_PROJECT_DRAFT_READY',url:current.url};
    if(current?.pathname===expected.pathname&&current?.composer)return first;
    await p.call('Page.navigate',{url:NV02_HOME_URL});
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){
      await sleep(250);
      try{
        const state=(await p.call('Runtime.evaluate',{expression:newChatContextExpr(),returnByValue:true},3000)).result.value;
        if(state?.composer&&state?.projectDraftReady===true)return{ok:true,status:'NEW_CHAT_PROJECT_DRAFT_READY',url:state.url};
        if(state?.pathname===expected.pathname&&state?.composer)return{ok:true,status:'NEW_CHAT_PROJECT_CONTEXT_RECOVERED',url:state.url};
      }catch{}
    }
    return{ok:false,status:'NEW_CHAT_PROJECT_CONTEXT_NOT_RECOVERED',url:current?.url||first?.url||null};
  }finally{p.close();}
}

async function reloadTarget(target){const p=await pageRpc(target);try{const pacingMs=await stabilityPace();log('UI_STABILITY_PACING',{action:'RELOAD',delayMs:pacingMs});await p.call('Page.reload',{ignoreCache:false});return{ok:true,status:'RELOADED',pacingMs};}finally{p.close();}}
async function waitForPostReloadNv02Ui(target,timeoutMs=12000){
  const deadline=Date.now()+timeoutMs;let last=null,busySignature='',busyStable=0,readySince=0;
  while(Date.now()<deadline){
    await sleep(750);
    const ui=await uiState(target).catch(()=>null);if(!ui)continue;last=ui;
    if(ui.securityBlock)return ui;
    if(ui.uiBusy===true){
      const sig=String(ui.activitySignature||'');
      busyStable=sig&&sig===busySignature?busyStable+1:1;busySignature=sig;readySince=0;
      if(busyStable>=2)return ui;
      continue;
    }
    busySignature='';busyStable=0;
    if(ui.uiPhase==='READY'){
      if(!readySince)readySince=Date.now();
      if(Date.now()-readySince>=1500)return ui;
    }else readySince=0;
  }
  return last;
}
async function waitForIdleAfterSubmission(target,timeoutMs=45000,stableReadyMs=5000){
  const deadline=Date.now()+timeoutMs;let readySince=0;
  while(Date.now()<deadline){
    await sleep(1200);
    const ui=await uiState(target);
    if(ui.securityBlock)throw new Error(ui.securityBlock);
    if(!ui.uiBusy&&ui.uiPhase==='READY'){
      if(!readySince)readySince=Date.now();
      if(Date.now()-readySince>=stableReadyMs)return ui;
    }else readySince=0;
  }
  throw new Error('NV02_STABLE_READY_TIMEOUT');
}
async function withNv02Mutation(fn,purpose='NORMAL',ttlMs=30000){
  if(nv02MutationBusy)return{ok:false,status:'MUTATION_LEASE_BUSY'};
  nv02MutationBusy=true;
  let sharedLease=null;
  let sharedMode='CONTROLLER';
  try{
    try{
      sharedLease=await acquireBridgeMutationLease('NV02',purpose,ttlMs);
      if(!sharedLease){
        log('NV02_SHARED_MUTATION_BUSY',{purpose,ttlMs});
        return{ok:false,status:'MUTATION_LEASE_BUSY'};
      }
    }catch(error){
      const message=String(error?.message||error);
      const unavailable=/fetch failed|ECONNREFUSED|ECONNRESET|AbortError|TimeoutError|UND_ERR_CONNECT_TIMEOUT/i.test(message);
      if(!unavailable){
        log('NV02_SHARED_MUTATION_DENIED',{purpose,error:message});
        return{ok:false,status:'MUTATION_LEASE_BUSY'};
      }
      sharedMode='LOCAL_FALLBACK';
      log('NV02_SHARED_MUTATION_CONTROLLER_UNAVAILABLE',{purpose,error:message});
    }
    log('NV02_LOCAL_MUTATION_ACQUIRED',{purpose,ttlMs,sharedMode});
    return await fn();
  }finally{
    if(sharedLease)await releaseBridgeMutationLease('NV02',sharedLease);
    nv02MutationBusy=false;
    log('NV02_LOCAL_MUTATION_RELEASED',{purpose,sharedMode});
  }
}
function findContinuableNv02Work(controllerState){
  return (controllerState?.jobs||[]).find((job)=>
    job?.workerId==='NV02'
    &&['SUBMITTED','WORKING','WAITING_EVIDENCE','VERIFY'].includes(String(job?.stage||''))
    &&!job?.completedAt
    &&typeof job?.issueRef==='string'
    &&job.issueRef.trim().length>0
  )||null;
}
function sameContinuableNv02Work(expected,current){
  if(!expected||!current)return false;
  const sameIssue=String(expected.issueRef||'').trim()===String(current.issueRef||'').trim();
  const expectedJob=String(expected.jobId||'').trim(),currentJob=String(current.jobId||'').trim();
  return sameIssue&&(!expectedJob||!currentJob||expectedJob===currentJob);
}
function buildCurrentWorkRestorePrompt({currentWork,receipt}){
  const issueRef=String(currentWork?.issueRef||'').trim();
  const jobId=String(currentWork?.jobId||'').trim();
  const checkpointRef=String(receipt?.checkpointRef||'').trim();
  const receiptRef=String(receipt?.receiptRef||'').trim();
  if(!issueRef||!checkpointRef||!receiptRef)throw new Error('CURRENT_WORK_RESTORE_INPUT_INVALID');
  return `LÀM — NO YAPPING. CURRENT_WORK_ORDER=${issueRef}${jobId?` | JOB_ID=${jobId}`:''}. CURRENT_CHECKPOINT=${checkpointRef}. DURABLE_SAVE_RECEIPT=${receiptRef}. Đọc đầy đủ CURRENT_WORK_ORDER và CURRENT_CHECKPOINT từ GitHub, xác minh trạng thái hiện hành rồi tiếp tục đúng công việc đó từ checkpoint. Không tự chọn backlog/P0/việc khác. Không dùng lệnh “Tiếp tục” chung chung để tự suy công việc. Chỉ dừng khi DONE có evidence, BLOCKED thật, EXTERNAL_WAIT hoặc hard gate.`;
}
async function dispatchCurrentWorkRestoreLocked(target,state,now,expectedWork,receipt){
  let controllerState;
  try{controllerState=await getControllerState();}
  catch(error){
    const next={...state,lastPhase:'STALLED',nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
    saveNv02Continuity(next);
    await continuityEvent('CURRENT_WORK_RESTORE_SKIPPED_UNVERIFIED',{error:String(error?.message||error),nextContinueAt:next.nextContinueAt});
    return next;
  }
  const currentWork=findContinuableNv02Work(controllerState);
  if(!hasContinuableNv02Work(controllerState)||!sameContinuableNv02Work(expectedWork,currentWork)){
    const next={...state,lastPhase:'READY',workingSignature:'',workingUnchangedChecks:0,nextProgressCheckAt:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
    saveNv02Continuity(next);
    await continuityEvent('CURRENT_WORK_RESTORE_SKIPPED_CHANGED_WORK',{expectedJobId:expectedWork?.jobId||null,expectedIssueRef:expectedWork?.issueRef||null,currentJobId:currentWork?.jobId||null,currentIssueRef:currentWork?.issueRef||null,nextContinueAt:next.nextContinueAt});
    return next;
  }
  const prompt=buildCurrentWorkRestorePrompt({currentWork,receipt});
  const result=await dispatch(target,prompt);
  if(!result?.ok)throw new Error(result?.status||'CURRENT_WORK_RESTORE_DISPATCH_FAILED');
  const next={...state,lastPrompt:'CURRENT_WORK_RESTORE',dispatchesInChat:Number(state.dispatchesInChat||0)+1,stalledChecks:0,lastPhase:'WORKING',workingSignature:'',workingUnchangedChecks:0,workingRecheckAt:nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS),nextProgressCheckAt:now+WORKING_PROGRESS_CHECK_MS,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
  saveNv02Continuity(next);
  await continuityEvent('CURRENT_WORK_RESTORE_DISPATCHED',{jobId:currentWork.jobId||null,issueRef:currentWork.issueRef,checkpointRef:receipt.checkpointRef,receiptRef:receipt.receiptRef,evidence:result.evidence||null,nextContinueAt:next.nextContinueAt});
  return next;
}
async function dispatchNaturalContinueLocked(target,state,now){
  if(await externalAutopilotOwnsNextNv02Job()){
    const next={...state,nextContinueAt:now+5000};
    saveNv02Continuity(next);
    await continuityEvent('CONTINUE_DEFERRED_TO_EXTERNAL_AUTOPILOT',{nextContinueAt:next.nextContinueAt});
    return next;
  }
  let controllerState;
  try{controllerState=await getControllerState();}
  catch(error){
    const next={...state,lastPhase:'STALLED',nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
    saveNv02Continuity(next);
    await continuityEvent('CONTINUE_SKIPPED_CURRENT_WORK_UNVERIFIED',{error:String(error?.message||error),nextContinueAt:next.nextContinueAt});
    return next;
  }
  const currentWork=findContinuableNv02Work(controllerState);
  if(!hasContinuableNv02Work(controllerState)||!currentWork){
    const next={...state,lastPhase:'READY',workingSignature:'',workingUnchangedChecks:0,nextProgressCheckAt:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
    saveNv02Continuity(next);
    await continuityEvent('CONTINUE_SKIPPED_NO_CURRENT_WORK',{nextContinueAt:next.nextContinueAt});
    return next;
  }
  await continuityEvent('CONTINUE_CURRENT_WORK_VERIFIED',{jobId:currentWork.jobId||null,issueRef:currentWork.issueRef});
  // Model/profile is verified once per opened chat/session and again only after
  // reopen/project recovery/URL change. The hot continue loop must not open
  // the model selector before every command.
  await scrollToBottom(target).catch(()=>{});
  const prompt=pickContinuePrompt(state.lastPrompt);
  const result=await dispatch(target,prompt);
  if(!result?.ok)throw new Error(result?.status||'CONTINUE_DISPATCH_FAILED');
  const next={...state,lastPrompt:prompt,dispatchesInChat:Number(state.dispatchesInChat||0)+1,stalledChecks:0,lastPhase:'WORKING',workingSignature:'',workingUnchangedChecks:0,workingRecheckAt:nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS),nextProgressCheckAt:now+WORKING_PROGRESS_CHECK_MS,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
  saveNv02Continuity(next);
  await continuityEvent('CONTINUE_DISPATCHED',{prompt,evidence:result.evidence||null,nextContinueAt:next.nextContinueAt,dispatchesInChat:next.dispatchesInChat});
  return next;
}
async function dispatchNaturalContinue(target,state,now){
  return withNv02Mutation(()=>dispatchNaturalContinueLocked(target,state,now),'CONTINUITY_CONTINUE');
}
async function checkpointNv02(target,currentWork){
  if(!currentWork?.issueRef)throw new Error('CHECKPOINT_CURRENT_WORK_REQUIRED');
  return withNv02Mutation(async()=>{
    await ensureNv02ModelProfile(target);
    const saveToken=crypto.randomUUID(),dispatchedAt=new Date().toISOString();
    const workRef=String(currentWork.issueRef).trim(),jobId=String(currentWork.jobId||'').trim()||'UNKNOWN';
    const text=`${buildDurableSavePrompt({saveToken,workerId:'NV02',dispatchedAt})}\nCURRENT_WORK_ORDER=${workRef}\nCURRENT_WORK_JOB_ID=${jobId}\nCheckpoint đúng công việc này; không chuyển sang việc khác.`;
    const sent=await dispatch(target,text);
    if(!sent?.ok)throw new Error(sent?.status||'SAVE_DISPATCH_FAILED');
    const receipt=await waitForDurableSaveReceipt(saveToken,'NV02',dispatchedAt);
    await waitForIdleAfterSubmission(target,45000,5000);
    await continuityEvent('CHECKPOINT_DURABLE',{receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,verifiedAt:receipt.verifiedAt});
    return receipt;
  },'CHECKPOINT_DURABLE',120000);
}
async function rotateNv02Chat(target,state,now){
  let controllerState;
  try{controllerState=await getControllerState();}
  catch(error){
    await continuityEvent('CHAT_ROTATION_SKIPPED_CURRENT_WORK_UNVERIFIED',{error:String(error?.message||error)});
    return state;
  }
  const currentWork=findContinuableNv02Work(controllerState);
  if(!hasContinuableNv02Work(controllerState)||!currentWork){
    await continuityEvent('CHAT_ROTATION_SKIPPED_NO_CURRENT_WORK',{lastPhase:state.lastPhase||null});
    return state;
  }
  await continuityEvent('CHAT_ROTATION_CURRENT_WORK_VERIFIED',{jobId:currentWork.jobId||null,issueRef:currentWork.issueRef});
  const receipt=await checkpointNv02(target,currentWork);
  const checkpointed={...state,dispatchesInChat:0,chatStartedAt:now,stalledChecks:0,chatLoadRecoveryStage:0,lastPhase:'READY',nextRefreshAt:nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS),rotationRetryAt:0};
  saveNv02Continuity(checkpointed);
  return withNv02Mutation(async()=>{
    const archived=await archiveChat(target);if(!archived?.ok)throw new Error(archived?.status||'ROTATE_ARCHIVE_FAILED');
    await continuityEvent('ARCHIVE_CONFIRMED',{jobId:currentWork.jobId||null,issueRef:currentWork.issueRef,receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,archiveStatus:archived.status});
    const archivedState={...checkpointed,resumeChatUrl:'',verifiedChatUrl:'',modelVerifiedAt:''};
    saveNv02Continuity(archivedState);
    const opened=await newChat(target);if(!opened?.ok)throw new Error(opened?.status||'ROTATE_NEW_CHAT_FAILED');
    await continuityEvent('NEW_CHAT_CREATED',{newChatStatus:opened.status});
    const freshUi=await ensureNv02ModelProfile(target);
    if(freshUi?.securityBlock)throw new Error(freshUi.securityBlock);
    if(freshUi?.modelExact!==true||freshUi?.uiPhase!=='READY')throw new Error('ROTATE_MODEL_PROFILE_NOT_READY');
    const verified=loadNv02Continuity();
    const next={...archivedState,lastPhase:'READY',verifiedChatUrl:verified.verifiedChatUrl,modelVerifiedAt:verified.modelVerifiedAt,modelCheckBlockedUntil:verified.modelCheckBlockedUntil};
    saveNv02Continuity(next);
    await continuityEvent('CHAT_ROTATED',{jobId:currentWork.jobId||null,issueRef:currentWork.issueRef,receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,archiveStatus:archived.status,newChatStatus:opened.status,nextRefreshAt:next.nextRefreshAt});
    return dispatchCurrentWorkRestoreLocked(target,next,now,currentWork,receipt);
  },'CHAT_ROTATION',60000);
}
async function noteNv02CommandDispatch(){
  const state=loadNv02Continuity();
  state.dispatchesInChat=Number(state.dispatchesInChat||0)+1;
  saveNv02Continuity(state);
}
async function maybeNv02Continuity(w,target,ui,{allowContinue=true}={}){
  const now=Date.now();let state=loadNv02Continuity();
  ui=applyNv02DurableVerifiedModelProfile(ui);
  const phase=deriveNv02Phase(ui||{});
  const currentTrackedWork=hasCurrentNv02Chat(ui?.url);
  state={...state,lastPhase:phase,...(currentTrackedWork?{resumeChatUrl:String(ui.url||'')}:{})};saveNv02Continuity(state);
  if(phase!=='BLOCKED'&&ui?.scrollToBottomVisible===true&&now>=Number(state.nextViewFollowAt||0)){
    const locallyBusy=nv02MutationBusy||workerMutationBusy.has('NV02');
    const followed=locallyBusy
      ? {ok:false,status:'VIEW_FOLLOW_LOCAL_BUSY'}
      : await scrollToBottom(target).catch(error=>({ok:false,status:'VIEW_FOLLOW_ERROR',error:String(error?.message||error)}));
    state=loadNv02Continuity();
    const deferred=followed?.status==='VIEW_FOLLOW_LOCAL_BUSY';
    state={...state,nextViewFollowAt:deferred?now+5000:nextRandomAt(now,VIEW_FOLLOW_MIN_MS,VIEW_FOLLOW_MAX_MS)};
    saveNv02Continuity(state);
    await continuityEvent(deferred?'VIEW_FOLLOW_BOTTOM_DEFERRED':'VIEW_FOLLOW_BOTTOM',{status:followed?.status||null,pacingMs:followed?.pacingMs||null,nextViewFollowAt:state.nextViewFollowAt});
  }
  if(phase==='BLOCKED'){await continuityEvent('BLOCKED',{securityBlock:ui?.securityBlock||null});return;}
  if(phase==='WORKING'){
    if(now<Number(state.nextProgressCheckAt||0))return;
    const signature=String(ui?.activitySignature||'');
    const same=Boolean(signature&&state.workingSignature===signature);
    const unchanged=same?Number(state.workingUnchangedChecks||0)+1:0;
    const workingRecheckAt=same
      ? (Number(state.workingRecheckAt)||nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS))
      : nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS);
    state={...state,stalledChecks:0,workingSignature:signature,workingUnchangedChecks:unchanged,workingRecheckAt,nextProgressCheckAt:now+WORKING_PROGRESS_CHECK_MS};
    saveNv02Continuity(state);
    await continuityEvent('WORKING_PROGRESS_CHECK',{workingUnchangedChecks:unchanged,workingRecheckAt:state.workingRecheckAt,nextProgressCheckAt:state.nextProgressCheckAt,signaturePresent:Boolean(signature)});
    if(unchanged>=MAX_WORKING_UNCHANGED_CHECKS){
      await continuityEvent('WORKING_LONG_RUNNING_NO_MUTATION',{workingUnchangedChecks:unchanged,workingRecheckAt:state.workingRecheckAt,nextProgressCheckAt:state.nextProgressCheckAt});
    }
    if(unchanged>=MAX_WORKING_UNCHANGED_CHECKS+2){
      const recovered=await withNv02Mutation(async()=>{
        const stopped=await stopStalledWorking(target);
        if(stopped?.ok)return {...stopped,method:'STOP'};
        const reloaded=await reloadTarget(target);
        const after=await waitForPostReloadNv02Ui(target,12000);
        return {ok:true,status:'WORKING_STUCK_RELOADED',method:'RELOAD',reloadStatus:reloaded?.status||null,afterBusy:after?.uiBusy===true,afterPhase:after?.uiPhase||null};
      },'WORKING_STUCK_RECOVERY',45000);
      if(recovered?.status==='MUTATION_LEASE_BUSY')return;
      state={...loadNv02Continuity(),workingSignature:'',workingUnchangedChecks:0,nextProgressCheckAt:0,workingRecheckAt:0,chatLoadRecoveryStage:3,rotationRetryAt:0,nextContinueAt:now};
      saveNv02Continuity(state);
      await continuityEvent('WORKING_STUCK_RECOVERY',{status:recovered?.status||null,method:recovered?.method||null,afterBusy:recovered?.afterBusy??false,rotationArmed:true});
    }
    return;
  }
  const chatLoadRecoveryHandled=await maybeRecoverChatLoadError(w,target,ui,now);
  if(chatLoadRecoveryHandled)return;
  state=loadNv02Continuity();
  if(shouldRotateNv02Chat({phase,currentTrackedWork,now,nextRefreshAt:state.nextRefreshAt,dispatchesInChat:state.dispatchesInChat,chatStartedAt:state.chatStartedAt,rotationRetryAt:state.rotationRetryAt,chatLoadRecoveryStage:state.chatLoadRecoveryStage})){
    if(await externalAutopilotOwnsNextNv02Job()){
      state={...state,rotationRetryAt:now+60_000};saveNv02Continuity(state);
      await continuityEvent('CHAT_ROTATION_DEFERRED_TO_EXTERNAL_AUTOPILOT',{rotationRetryAt:state.rotationRetryAt});
      return;
    }
    await continuityEvent('CHAT_ROTATION_DUE',{dispatchesInChat:state.dispatchesInChat,chatStartedAt:state.chatStartedAt,nextRefreshAt:state.nextRefreshAt});
    try{await rotateNv02Chat(target,state,now);}
    catch(error){
      const retry={...state,rotationRetryAt:now+5*60*1000};
      saveNv02Continuity(retry);
      await continuityEvent('CHAT_ROTATION_FAILED',{error:String(error?.message||error),rotationRetryAt:retry.rotationRetryAt});
    }
    return;
  }
  if(!currentTrackedWork&&hasCurrentNv02Chat(state.resumeChatUrl)){
    const restored=await withNv02Mutation(async()=>{
      await navigate(target,state.resumeChatUrl);
      await sleep(1200);
      return{ok:true,status:'CURRENT_CHAT_RESTORED',url:state.resumeChatUrl};
    },'CURRENT_CHAT_RESTORE',30000);
    await continuityEvent(restored?.status==='MUTATION_LEASE_BUSY'?'CURRENT_CHAT_RESTORE_DEFERRED':'CURRENT_CHAT_RESTORED',{status:restored?.status||null,url:state.resumeChatUrl});
    return;
  }
  if(currentTrackedWork&&now>=Number(state.nextPeriodicF5At||0)){
    const refreshed=await withNv02Mutation(async()=>{
      const beforeUrl=ui?.url||null;
      const beforePhase=phase;
      const result=await reloadTarget(target);
      await sleep(1800);
      const after=await uiState(target).catch(()=>null);
      return {ok:true,status:result?.status||'RELOADED',beforeUrl,beforePhase,afterUrl:after?.url||null,afterPhase:after?.uiPhase||null};
    },'PERIODIC_F5_REFRESH',15000);
    if(refreshed?.status==='MUTATION_LEASE_BUSY'){
      state={...state,nextPeriodicF5At:now+5000};saveNv02Continuity(state);
      await continuityEvent('PERIODIC_F5_RETRY_LEASE_BUSY',{nextPeriodicF5At:state.nextPeriodicF5At});
      return;
    }
    state={...state,
      nextPeriodicF5At:nextRandomAt(now,NV02_F5_MIN_MS,NV02_F5_MAX_MS),
      workingSignature:'',
      workingUnchangedChecks:0,
      nextProgressCheckAt:0,
      stalledChecks:0,
      modelCheckBlockedUntil:now+30000,
    };
    saveNv02Continuity(state);
    await continuityEvent('PERIODIC_F5_REFRESH',{beforeUrl:refreshed?.beforeUrl||null,beforePhase:refreshed?.beforePhase||phase,afterUrl:refreshed?.afterUrl||null,afterPhase:refreshed?.afterPhase||null,nextPeriodicF5At:state.nextPeriodicF5At});
    return;
  }
  const modelCheckRequired=now>=Number(state.modelCheckBlockedUntil||0)&&(ui?.modelExact!==true||!state.verifiedChatUrl||!sameNv02Chat(state.verifiedChatUrl,ui?.url));
  if(phase==='STALLED'&&ui?.modelExact!==true&&modelCheckRequired){
    try{
      const corrected=await withNv02Mutation(()=>ensureNv02ModelProfile(target),'MODEL_PROFILE_RECOVERY');
      if(corrected?.status==='MUTATION_LEASE_BUSY')return;
      const recoveredProjectContext=isNv02ProjectContext(corrected?.url)||corrected?.projectDraftReady===true;
      if(!recoveredProjectContext)throw new Error('PROJECT_CONTEXT_NOT_READY_AFTER_MODEL_RECOVERY');
      await postWorkerHeartbeat(w,target,corrected,recoveredProjectContext).catch(()=>{});
      state={...state,stalledChecks:0,nextContinueAt:now};saveNv02Continuity(state);
      if(corrected?.uiPhase==='READY')await dispatchNaturalContinue(target,state,now);
      return;
    }catch(error){
      state={...state,modelCheckBlockedUntil:now+60_000};
      saveNv02Continuity(state);
      await continuityEvent('MODEL_PROFILE_RECOVERY_FAILED',{error:String(error?.message||error),modelCheckBlockedUntil:state.modelCheckBlockedUntil});
    }
  }
  if(!currentTrackedWork){
    if(now>=state.nextContinueAt){
      state={...state,stalledChecks:0,workingSignature:'',workingUnchangedChecks:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
      saveNv02Continuity(state);
      await continuityEvent('CONTINUE_SKIPPED_NO_CURRENT_CHAT',{nextContinueAt:state.nextContinueAt});
    }
    return;
  }
  if(now<state.nextContinueAt)return;
  if(phase==='READY'){
    const sent=await dispatchNaturalContinue(target,state,now);
    if(sent?.status==='MUTATION_LEASE_BUSY'){
      state={...state,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
    }
    return;
  }
  state={...state,stalledChecks:Math.min(MAX_STALLED_CHECKS,state.stalledChecks+1),nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
  saveNv02Continuity(state);
  await continuityEvent('STALLED_CHECK',{stalledChecks:state.stalledChecks,nextContinueAt:state.nextContinueAt});
  if(state.stalledChecks===2){
    const result=await withNv02Mutation(()=>reloadTarget(target),'STALLED_RECOVERY');
    await continuityEvent('STALLED_RELOAD',{status:result?.status||null});
  }else if(state.stalledChecks>=MAX_STALLED_CHECKS){
    await continuityEvent('STALLED_HOT_LOOP_NO_CHECKPOINT',{stalledChecks:state.stalledChecks});
    const clean={...state,stalledChecks:0,workingSignature:'',workingUnchangedChecks:0,nextProgressCheckAt:0,nextContinueAt:now};
    saveNv02Continuity(clean);
  }
}
async function handleCommand(w,target,command){
  const {action,payload={}}=command;
  if(action==='FOCUS') return focus(target).then(()=>({status:'FOCUSED'}));
  if(action==='LAYOUT') return layout(w,target,payload).then(()=>({status:'LAYOUT_APPLIED'}));
  if(action==='CLOSE_WINDOW') return closeWorker(w,target).then(()=>({status:'WINDOW_CLOSED'}));
  if(action==='NAVIGATE'){const u=new URL(String(payload.url||''));if(u.hostname!==expectedHost(w))throw new Error('BLOCKED_URL');await navigate(target,u.toString());return{status:'NAVIGATED'};}
  if(action==='MODEL_PREFLIGHT'){if(w.id!=='NV02')return{status:'MODEL_PREFLIGHT_NOT_REQUIRED'};return ensureNv02ModelProfile(target);}
  if(action==='DISPATCH'){if(w.id==='NV02')await ensureNv02ModelProfile(target);const r=await dispatch(target,String(payload.text||''));if(!r?.ok)throw new Error(r?.status||'DISPATCH_FAILED');return r;}
  if(action==='ARCHIVE_CHAT'){const r=await archiveChat(target);if(!r?.ok)throw new Error(r?.status||'ARCHIVE_FAILED');return r;}
  throw new Error(`UNKNOWN_ACTION:${action}`);
}
async function postWorkerHeartbeat(w,target,ui,projectContextReady){
  const windowId=await windowIdFor(workerPort(w),target.id);
  const display={workArea:{left:0,top:0,width:Number(config.layout?.fallbackWorkAreaWidth||3277),height:1688}};
  const normalizedPhase=w.id==='NV02'?String(ui?.uiPhase||'STALLED'):deriveWorkerPhase(ui||{},{workerId:w.id});
  await post('/api/heartbeat',w.id,{workerId:w.id,state:normalizedPhase,windowId,tabId:target.id,url:ui.url,active:true,uiReady:ui.uiReady,uiPhase:normalizedPhase,composerReady:ui.composerReady,sendReady:ui.sendReady,stopVisible:ui.stopVisible,scrollToBottomVisible:ui.scrollToBottomVisible,authRequired:ui.authRequired===true,uiBusy:ui.uiBusy,securityBlock:ui.securityBlock,chatLoadError:ui.chatLoadError===true,chatRetryReady:ui.chatRetryReady===true,modelControlPresent:ui.modelControlPresent,modelProfileStatus:ui.modelProfileStatus,modelName:ui.modelName,reasoningEffort:ui.reasoningEffort,modelReady:ui.modelReady,modelExact:ui.modelExact,verifiedAt:ui.verifiedAt,blockedReason:ui.blockedReason,projectContextReady,display});
}

async function tickWorker(w){
  const backoff=workerConnectivityBackoff.get(w.id);
  if(backoff&&Date.now()<Number(backoff.until||0))return;
  if(busy.has(w.id))return;busy.add(w.id);
  try{
    const port=workerPort(w);const list=await targets(port);
    if(backoff){
      workerConnectivityBackoff.delete(w.id);
      log('WORKER_CONNECTIVITY_RECOVERED',{workerId:w.id,attempt:Number(backoff.attempt||0)});
    }
    const target=await pruneDuplicates(w,list);if(!target)return;
    const rawUi=await uiState(target);
    const projectContextReady=w.id!=='NV02'||isNv02ProjectContext(rawUi.url)||rawUi.projectDraftReady===true;
    const ui=projectContextReady?rawUi:{...rawUi,uiReady:false,uiPhase:'STALLED',modelReady:false};
    await postWorkerHeartbeat(w,target,ui,projectContextReady).catch(error=>log('CONTROLLER_TELEMETRY_UNAVAILABLE',{error:String(error?.message||error)}));
    if(await workerAutomationPaused(w.id)){
      if(w.id==='NV02')await continuityEvent('AUTO_ACTION_PAUSED',{phase:String(ui?.uiPhase||'STALLED')});
      else await genericWorkerEvent(w.id,'AUTO_ACTION_PAUSED',{phase:String(ui?.uiPhase||'STALLED')});
      return;
    }
    if(w.id==='NV03'&&ui.uiBusy!==true){
      await pruneNv03DuplicateTabs(w,list,target,ui).catch(error=>log('DUPLICATE_TAB_PRUNE_FAILED',{workerId:w.id,error:String(error?.message||error)}));
    }
    const localMutationBusy=workerMutationBusy.has(w.id)||(w.id==='NV02'&&nv02MutationBusy);
    if(!localMutationBusy){
      let command=null;
      try{command=await getCommand(w.id);}
      catch(error){log('CONTROLLER_COMMAND_POLL_FAILED',{workerId:w.id,error:String(error?.message||error)});}
      if(command){
        workerMutationBusy.add(w.id);
        if(w.id==='NV02')nv02MutationBusy=true;
        try{
          const result=await handleCommand(w,target,command);
          await post('/api/result',w.id,{workerId:w.id,commandId:command.id,ok:true,...(result||{})});
          log('CONTROLLER_COMMAND_EXECUTED',{workerId:w.id,commandId:command.id,action:command.action,status:result?.status||'OK'});
        }catch(error){
          const status=String(error?.status||error?.message||error);
          await post('/api/result',w.id,{workerId:w.id,commandId:command.id,ok:false,status}).catch(postError=>log('CONTROLLER_COMMAND_RESULT_POST_FAILED',{workerId:w.id,commandId:command.id,error:String(postError?.message||postError)}));
          log('CONTROLLER_COMMAND_FAILED',{workerId:w.id,commandId:command.id,action:command.action,status});
        }finally{
          workerMutationBusy.delete(w.id);
          if(w.id==='NV02')nv02MutationBusy=false;
        }
        return;
      }
    }
    if(w.id==='NV02'&&!projectContextReady&&!ui.securityBlock){
      if(ui.uiBusy===true||ui.stopVisible===true){
        await maybeNv02Continuity(w,target,ui,{allowContinue:false});
        return;
      }
      if(!NV02_HOME_URL){await continuityEvent('PROJECT_CONTEXT_RECOVERY_BLOCKED',{reason:'NV02_HOME_URL_MISSING',url:rawUi.url||null});return;}
      const recovered=await withNv02Mutation(()=>recoverNv02ProjectContext(target),'PROJECT_CONTEXT_RECOVERY');
      await continuityEvent(recovered?.status==='MUTATION_LEASE_BUSY'?'PROJECT_CONTEXT_RECOVERY_DEFERRED':'PROJECT_CONTEXT_RECOVERY_NAVIGATED',{status:recovered?.status||null,fromUrl:rawUi.url||null});
      return;
    }
    if(w.id==='NV02')await maybeNv02Continuity(w,target,ui);
    else if(CONTINUITY_WORKERS.includes(w.id))await maybeWorkerContinuity(w,target,ui);
  }catch(error){
    const msg=String(error?.message||error);
    const connectivityFailure=/fetch failed|ECONNREFUSED|ECONNRESET|CDP_LIST|CDP_OPEN|AbortError|TimeoutError|UND_ERR_CONNECT_TIMEOUT/i.test(msg);
    if(w.id!=='NV02'&&connectivityFailure){
      const prior=workerConnectivityBackoff.get(w.id);
      const attempt=Math.min(Number(prior?.attempt||0)+1,5);
      const delayMs=Math.min(20_000,5_000*(2**(attempt-1)));
      const until=Date.now()+delayMs;
      workerConnectivityBackoff.set(w.id,{attempt,until,lastError:msg});
      log('WORKER_CONNECTIVITY_BACKOFF',{workerId:w.id,attempt,delayMs,until,error:msg});
    }else if(!/CDP_LIST|AbortError|TimeoutError/.test(msg)){
      log('WORKER_TICK_ERROR',{workerId:w.id,error:msg});
    }
  }finally{busy.delete(w.id);}
}

async function tick(){
  const worker=config.workers.find(w=>w.id==='NV02');
  const workers=CONTINUITY_WORKERS.map((id)=>config.workers.find((w)=>w.id===id)).filter((w)=>w&&w.enabled!==false);
  if(!worker)log('NV02_CONFIG_MISSING');
  if(!workers.length){log('WORKER_CONFIG_MISSING',{expected:CONTINUITY_WORKERS});return;}
  await Promise.allSettled(workers.map((w)=>tickWorker(w)));
}
const NV02_OWNER_LOCK='D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\nv02-canonical-owner.lock';
const WORKER_LOCK_DIR='D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\worker-locks';
try{fs.mkdirSync(WORKER_LOCK_DIR,{recursive:true});}catch{}
function pidAlive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function workerOwnerLockPath(workerId){return workerId==='NV02'?NV02_OWNER_LOCK:join(WORKER_LOCK_DIR,`${workerId.toLowerCase()}-canonical-owner.lock`);}
function acquireWorkerOwnership(workerId){
  const lockPath=workerOwnerLockPath(workerId);
  for(let attempt=0;attempt<2;attempt++){
    try{
      const fd=fs.openSync(lockPath,'wx');
      try{fs.writeFileSync(fd,JSON.stringify({workerId,pid:process.pid,approvedHead:APPROVED_HEAD,sourceSha256:BRIDGE_SHA256,bridgePath:BRIDGE_PATH,acquiredAt:new Date().toISOString()}),'utf8');}finally{fs.closeSync(fd);}
      return;
    }catch(error){
      if(error?.code!=='EEXIST')throw error;
      let existing={};
      try{existing=JSON.parse(fs.readFileSync(lockPath,'utf8'));}catch{}
      if(Number(existing.pid)>0&&pidAlive(Number(existing.pid))){
        const legacy=workerId==='NV02'?'NV02_DUPLICATE_CANONICAL_OWNERSHIP':`WORKER_DUPLICATE_CANONICAL_OWNERSHIP:${workerId}`;
        log(workerId==='NV02'?'NV02_DUPLICATE_CANONICAL_OWNERSHIP':'WORKER_DUPLICATE_CANONICAL_OWNERSHIP',{workerId,existingPid:Number(existing.pid),incomingPid:process.pid,existingHead:existing.approvedHead||null});
        throw new Error(legacy);
      }
      try{fs.unlinkSync(lockPath);}catch{}
    }
  }
  throw new Error(workerId==='NV02'?'NV02_CANONICAL_OWNERSHIP_LOCK_FAILED':`WORKER_CANONICAL_OWNERSHIP_LOCK_FAILED:${workerId}`);
}
function releaseWorkerOwnership(workerId){
  try{
    const lockPath=workerOwnerLockPath(workerId);
    const existing=JSON.parse(fs.readFileSync(lockPath,'utf8'));
    if(Number(existing.pid)===process.pid)fs.unlinkSync(lockPath);
  }catch{}
}
function acquireNv02CanonicalOwnership(){return acquireWorkerOwnership('NV02');}
function releaseNv02CanonicalOwnership(){return releaseWorkerOwnership('NV02');}
const ownedWorkers=CONTINUITY_WORKERS.filter((id)=>config.workers.some((w)=>w.id===id&&w.enabled!==false));
if(ownedWorkers.includes('NV02'))acquireNv02CanonicalOwnership();
for(const id of ownedWorkers.filter((id)=>id!=='NV02'))acquireWorkerOwnership(id);
function releaseAllWorkerOwnership(){for(const id of ownedWorkers)releaseWorkerOwnership(id);}
process.once('exit',releaseAllWorkerOwnership);
process.once('SIGTERM',()=>{releaseAllWorkerOwnership();process.exit(0);});
process.once('SIGINT',()=>{releaseAllWorkerOwnership();process.exit(0);});

const bridgeServer=http.createServer((req,res)=>{if(req.url==='/health'){const provenanceVerified=Boolean(APPROVED_HEAD&&DEPLOY_ROOT&&EXPECTED_BRIDGE_SHA256&&EXPECTED_BRIDGE_SHA256===BRIDGE_SHA256);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,mode:'NV02_ISOLATED_AUTO_CONTINUE',controllerRequired:false,controllerEnabledFlagIgnored:true,worker:'NV02',canonicalOwnership:true,workers:ownedWorkers,pid:process.pid,approvedHead:APPROVED_HEAD||null,deployRoot:DEPLOY_ROOT||null,sourceSha256:BRIDGE_SHA256,expectedSourceSha256:EXPECTED_BRIDGE_SHA256||null,provenanceVerified,continuity:loadNv02Continuity()}));return;}res.writeHead(404);res.end();});
bridgeServer.on('error',(error)=>{log('NV02_CANONICAL_OWNER_BIND_FAILED',{error:String(error),code:error?.code||null});releaseAllWorkerOwnership();process.exit(42);});
bridgeServer.listen(8799,'127.0.0.1',()=>log('BRIDGE_READY',{port:8799,mode:'NV02_ISOLATED_AUTO_CONTINUE',controllerRequired:false,controllerEnabledFlagIgnored:true,canonicalOwnership:true,pid:process.pid,approvedHead:APPROVED_HEAD||null,sourceSha256:BRIDGE_SHA256,provenanceVerified:Boolean(APPROVED_HEAD&&DEPLOY_ROOT&&EXPECTED_BRIDGE_SHA256&&EXPECTED_BRIDGE_SHA256===BRIDGE_SHA256)}));
setInterval(()=>void tick(),3000).unref();
void tick();
