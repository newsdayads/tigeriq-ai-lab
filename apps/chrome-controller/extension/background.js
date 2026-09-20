import { WORKER_HOSTS, allowedUrl, hostname, matchesWorker } from './url-policy.js';
import { buildDurableSavePrompt, waitForDurableSaveReceipt } from './save-receipt.js';
import { runArchiveCommand } from './archive-command.js';
import {
  CONTINUE_MIN_MS, CONTINUE_MAX_MS, REFRESH_MIN_MS, REFRESH_MAX_MS,
  MAX_STALLED_CHECKS, deriveNv02Phase, hasActiveNv02Work, hasWaitingEvidenceNv02Work,
  nextRandomAt, pickContinuePrompt,
} from './continuity.js';

const CONTROLLER = 'http://127.0.0.1:8798';
const LEGACY_PLUS_ID = ['NV','05'].join('');
const WORKER_LABELS = {
  NV03:'NV03 · ChatGPT Go',
  NV02:'NV02 · ChatGPT Plus',
  NV04:'NV04 · Gemini Pro'
};
const ARCHIVE_SUPPORTED_WORKERS = new Set(['NV02','NV03']);
const archiveInFlight = new Set();
let ticking = false;
const lastWindowByWorker = new Map();

function normalizeWorkerId(value) { return value === LEGACY_PLUS_ID ? 'NV02' : value; }
function markerWorkerId(value) {
  try {
    const u = new URL(value);
    const match = u.hash.match(/(?:^|[&#])tigeriq-worker=(NV03|NV04|NV02)(?:&|$)/i);
    return match ? match[1].toUpperCase() : null;
  } catch { return null; }
}
function stripWorkerMarker(value) {
  try {
    const u = new URL(value);
    const parts = u.hash.replace(/^#/, '').split('&').filter((p) => p && !/^tigeriq-worker=/i.test(p));
    u.hash = parts.length ? `#${parts.join('&')}` : '';
    return u.toString();
  } catch { return value; }
}

async function bootstrapWorkerIds() {
  const saved = await chrome.storage.local.get(['workerIds','workerId']);
  const rawIds = Array.isArray(saved.workerIds) ? saved.workerIds : (saved.workerId ? [saved.workerId] : []);
  const normalizedIds = rawIds.map(normalizeWorkerId).filter((id) => WORKER_HOSTS[id]);
  const ids = new Set(normalizedIds);
  let changed = normalizedIds.length !== rawIds.length || rawIds.some((id) => normalizeWorkerId(id) !== id) || Boolean(saved.workerId);
  const wins = await chrome.windows.getAll({ populate:true, windowTypes:['normal'] });
  for (const win of wins) {
    for (const tab of win.tabs || []) {
      const id = markerWorkerId(tab.url || '');
      if (!id || !matchesWorker(id, tab.url || '')) continue;
      const sameHostId = [...ids].find((existing) => existing !== id && WORKER_HOSTS[existing] === WORKER_HOSTS[id]);
      if (sameHostId) continue;
      if (!ids.has(id)) { ids.add(id); changed = true; }
      if (tab.id) await chrome.tabs.update(tab.id, { url: stripWorkerMarker(tab.url || '') });
    }
  }
  if (changed) {
    await chrome.storage.local.set({ workerIds:[...ids] });
    await chrome.storage.local.remove('workerId');
  }
  return [...ids];
}

async function getWorkerIds() { return bootstrapWorkerIds(); }

async function findContext(workerId) {
  const wins = await chrome.windows.getAll({ populate:true, windowTypes:['normal'] });
  const exact = [];
  const hostOnly = [];
  for (const win of wins) {
    for (const tab of win.tabs || []) {
      const url = tab.url || '';
      if (hostname(url) !== WORKER_HOSTS[workerId]) continue;
      const item = { windowId:win.id, tabId:tab.id, url, active:Boolean(tab.active) };
      hostOnly.push(item);
      if (matchesWorker(workerId, url)) exact.push(item);
    }
  }
  const choose = (items) => {
    if (!items.length) return null;
    if (items.length === 1) return items[0];
    const active = items.filter((c) => c.active);
    return active.length === 1 ? active[0] : items[0];
  };
  return choose(exact) || choose(hostOnly);
}

async function updateWorkerBadge(workerId, ctx) {
  const exact = matchesWorker(workerId, ctx.url || '');
  const badgeText = exact ? workerId.slice(2) : '';
  await chrome.action.setBadgeText({ text: badgeText });
  await chrome.action.setTitle({ title: exact ? `TigerIQ · ${WORKER_LABELS[workerId]}` : 'TigerIQ Chrome Controller' });
  if (!ctx.tabId) return;
  try {
    await chrome.tabs.sendMessage(ctx.tabId, {
      type:'TIGERIQ_WORKER_BADGE',
      workerId: exact ? workerId : null,
      label: exact ? WORKER_LABELS[workerId] : ''
    });
  } catch { /* content script may not be ready yet; next tick retries */ }
}

async function displayInfo(windowId) {
  const displays = await chrome.system.display.getInfo();
  let selected = null;
  try {
    const win = windowId ? await chrome.windows.get(windowId) : null;
    if (win && Number.isFinite(win.left) && Number.isFinite(win.top) && Number.isFinite(win.width) && Number.isFinite(win.height)) {
      const x = win.left + win.width / 2;
      const y = win.top + win.height / 2;
      selected = displays.find((d) => {
        const b = d.bounds;
        return b && x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height;
      }) || null;
    }
  } catch { /* window may disappear between context lookup and heartbeat */ }
  if (!selected) selected = displays.find((d) => d.isPrimary) || displays[0] || null;
  return selected ? { workArea:selected.workArea } : undefined;
}
async function post(path,data) {
  const r = await fetch(`${CONTROLLER}${path}`,{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(data)});
  if(!r.ok) throw new Error(`HTTP_${r.status}`);
  return r.json();
}
async function get(path) {
  const r = await fetch(`${CONTROLLER}${path}`);
  if(!r.ok) throw new Error(`HTTP_${r.status}`);
  return r.json();
}
function sleep(ms){return new Promise((resolve)=>setTimeout(resolve,ms));}
async function readUiState(ctx) {
  try {
    if (!ctx?.tabId) return { uiBusy:null, uiPhase:'STALLED', composerReady:false, sendReady:false, stopVisible:false, scrollToBottomVisible:false, authRequired:false, securityBlock:null };
    const value=await chrome.tabs.sendMessage(ctx.tabId,{type:'TIGERIQ_UI_STATE'});
    const uiBusy=typeof value?.uiBusy==='boolean'?value.uiBusy:null;
    return {
      uiBusy,
      uiPhase:String(value?.uiPhase||deriveNv02Phase(value||{})),
      composerReady:value?.composerReady===true,
      sendReady:value?.sendReady===true,
      stopVisible:value?.stopVisible===true,
      scrollToBottomVisible:value?.scrollToBottomVisible===true,
      authRequired:value?.authRequired===true,
      securityBlock:value?.securityBlock?String(value.securityBlock):null,
      modelProfileStatus:value?.modelProfileStatus?String(value.modelProfileStatus):null,
      modelName:value?.modelName?String(value.modelName):null,
      reasoningEffort:value?.reasoningEffort?String(value.reasoningEffort):null,
      modelReady:value?.modelReady===true,
      modelExact:value?.exact===true,
      verifiedAt:value?.verifiedAt?String(value.verifiedAt):null,
      blockedReason:value?.blockedReason?String(value.blockedReason):null,
    };
  } catch { return { uiBusy:null, uiPhase:'STALLED', composerReady:false, sendReady:false, stopVisible:false, scrollToBottomVisible:false, authRequired:false, securityBlock:null }; }
}
async function heartbeat(workerId,ctx) {
  const ui=await readUiState(ctx);
  await post('/api/heartbeat',{workerId,state:ui.uiPhase||'STALLED',...ctx,uiBusy:ui.uiBusy,uiPhase:ui.uiPhase,composerReady:ui.composerReady,sendReady:ui.sendReady,stopVisible:ui.stopVisible,scrollToBottomVisible:ui.scrollToBottomVisible,authRequired:ui.authRequired,securityBlock:ui.securityBlock,modelProfileStatus:ui.modelProfileStatus,modelName:ui.modelName,reasoningEffort:ui.reasoningEffort,modelReady:ui.modelReady,modelExact:ui.modelExact,verifiedAt:ui.verifiedAt,blockedReason:ui.blockedReason,display:await displayInfo(ctx.windowId)});
}

async function waitForTabComplete(tabId,timeoutMs=60000) {
  const current=await chrome.tabs.get(tabId); if(current.status==='complete') return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(new Error('NAVIGATION_TIMEOUT'));},timeoutMs);
    const listener=(id,info)=>{if(id===tabId&&info.status==='complete'){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve();}};
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function doneEvidence(snapshot,workerId){
  const job=snapshot?.previousJob;
  if(!job||job.workerId!==workerId||job.status!=='DONE') return null;
  const evidence=(job.evidence||[]).find((item)=>['GITHUB','CORE'].includes(item?.source)&&String(item?.ref||'').trim()&&item?.verifiedAt);
  return evidence?{job,evidence}:null;
}

async function assertArchiveAllowed(workerId,{requireDone=true}={}){
  if(!ARCHIVE_SUPPORTED_WORKERS.has(workerId)) throw new Error(`ARCHIVE_SELECTOR_UNVERIFIED:${workerId}`);
  const state=await get('/api/state');
  if(state.killed) throw new Error('ARCHIVE_CONTROLLER_KILLED');
  if(state.paused) throw new Error('ARCHIVE_OWNER_INTERACTION_READ_ONLY');
  const worker=(state.workers||[]).find((item)=>item.id===workerId);
  if(!worker?.enabled) throw new Error(`ARCHIVE_WORKER_DISABLED:${workerId}`);
  if(worker.blocked) throw new Error(`ARCHIVE_WORKER_BLOCKED:${workerId}`);
  if(worker.lastHeartbeat?.securityBlock) throw new Error(String(worker.lastHeartbeat.securityBlock));
  if(worker.lastHeartbeat?.uiBusy!==false) throw new Error('ARCHIVE_UI_NOT_IDLE');

  const autopilot=await get('/api/autopilot/state');
  if(workerId==='NV02'&&(autopilot.state?.pendingJobId||autopilot.state?.uncertainJobId)) throw new Error('ARCHIVE_ACTIVE_JOB_FORBIDDEN');
  const previous=autopilot.snapshot?.previousJob;
  if(previous?.workerId===workerId&&['QUEUED','READY','RUNNING','WAITING','BLOCKED','REVIEWING'].includes(previous.status)) throw new Error('ARCHIVE_ACTIVE_JOB_FORBIDDEN');
  const proof=doneEvidence(autopilot.snapshot,workerId);
  if(requireDone&&!proof) throw new Error('ARCHIVE_EXTERNAL_DONE_EVIDENCE_REQUIRED');
  return proof?{jobId:proof.job.jobId,evidenceRef:proof.evidence.ref}:{jobId:null,evidenceRef:null};
}

async function waitForSaveCompletion(ctx){
  const start=Date.now();
  const observeBusyUntil=start+20000;
  const deadline=start+120000;
  let sawBusy=false;
  while(Date.now()<deadline){
    const ui=await readUiState(ctx);
    if(ui.securityBlock) throw new Error(ui.securityBlock);
    if(ui.uiBusy===true) sawBusy=true;
    if(sawBusy&&ui.uiBusy===false) return;
    if(!sawBusy&&Date.now()>observeBusyUntil) throw new Error('SAVE_RESPONSE_NOT_OBSERVED');
    await sleep(1000);
  }
  throw new Error('SAVE_RESPONSE_TIMEOUT');
}

async function recordArchivedJob(workerId,jobId){
  const saved=await chrome.storage.local.get(['lastArchivedJobByWorker']);
  const last={...(saved.lastArchivedJobByWorker||{}),[workerId]:jobId};
  await chrome.storage.local.set({lastArchivedJobByWorker:last});
}

async function saveAndArchive(workerId,{requireDone=true}={}){
  workerId=normalizeWorkerId(workerId);
  if(archiveInFlight.has(workerId)) throw new Error(`ARCHIVE_ALREADY_IN_FLIGHT:${workerId}`);
  archiveInFlight.add(workerId);
  try{
    const proof=await assertArchiveAllowed(workerId,{requireDone});
    const ctx=await findContext(workerId);
    if(!ctx||!ctx.tabId||!matchesWorker(workerId,ctx.url)) throw new Error('ARCHIVE_WORKER_WINDOW_AMBIGUOUS_OR_MISSING');
    const saveToken=crypto.randomUUID();
    const dispatchedAt=new Date().toISOString();
    const saveText=buildDurableSavePrompt({saveToken,workerId,dispatchedAt});
    await chrome.tabs.update(ctx.tabId,{active:true});
    const save=await chrome.tabs.sendMessage(ctx.tabId,{type:'TIGERIQ_DISPATCH',text:saveText,workerId});
    if(!save?.ok) throw new Error(String(save?.status||'SAVE_DISPATCH_FAILED'));
    await waitForSaveCompletion(ctx);
    const receipt=await waitForDurableSaveReceipt(saveToken,workerId,dispatchedAt);
    await assertArchiveAllowed(workerId,{requireDone});
    const result=await chrome.tabs.sendMessage(ctx.tabId,{type:'TIGERIQ_ARCHIVE_CONVERSATION'});
    if(!result?.ok) throw new Error(String(result?.status||'ARCHIVE_FAILED'));
    if(proof.jobId)await recordArchivedJob(workerId,proof.jobId);
    return {ok:true,status:'ARCHIVED',workerId,jobId:proof.jobId,evidenceRef:proof.evidenceRef,receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,receiptVerifiedAt:receipt.verifiedAt};
  }finally{archiveInFlight.delete(workerId);}
}

async function maybeAutoArchive(workerId){
  if(!ARCHIVE_SUPPORTED_WORKERS.has(workerId)||archiveInFlight.has(workerId)) return;
  const saved=await chrome.storage.local.get(['archiveAfterDone','lastArchivedJobByWorker','archiveAttemptByJob']);
  if(saved.archiveAfterDone!==true) return;
  const autopilot=await get('/api/autopilot/state');
  const proof=doneEvidence(autopilot.snapshot,workerId);
  if(!proof) return;
  if(saved.lastArchivedJobByWorker?.[workerId]===proof.job.jobId) return;
  const key=`${workerId}:${proof.job.jobId}`;
  const attempts={...(saved.archiveAttemptByJob||{})};
  const count=Number(attempts[key]||0);
  if(count>=2) return;
  attempts[key]=count+1;
  await chrome.storage.local.set({archiveAttemptByJob:attempts});
  try{await saveAndArchive(workerId,{requireDone:true});}catch{/* bounded fail-closed; evidence remains unmodified */}
}


async function precheckNv02Profile(ctx, purpose='DISPATCH') {
  if (!ctx?.tabId) throw new Error('MODEL_PROFILE_BLOCKED:NO_TAB');
  const profile = await chrome.tabs.sendMessage(ctx.tabId, { type: 'TIGERIQ_MODEL_PROFILE_PRECHECK', purpose });
  try {
    await post('/api/heartbeat', { workerId:'NV02', state: profile?.exact ? 'READY' : 'BLOCKED', ...ctx, modelProfileStatus:profile?.modelProfileStatus||'MODEL_PROFILE_BLOCKED', modelName:profile?.modelName||null, reasoningEffort:profile?.reasoningEffort||null, modelReady:profile?.modelReady===true, modelExact:profile?.exact===true, verifiedAt:profile?.verifiedAt||null, blockedReason:profile?.blockedReason||null, display:await displayInfo(ctx.windowId) });
  } catch { /* heartbeat best effort; dispatch remains fail-closed */ }
  if (!profile?.exact) throw new Error(`MODEL_PROFILE_BLOCKED:${profile?.blockedReason||profile?.modelProfileStatus||'UNVERIFIED'}`);
  return profile;
}

async function execute(workerId,command) {
  const {action,payload={}}=command;
  const ctx=await findContext(workerId);
  if(!ctx) throw new Error('WORKER_WINDOW_AMBIGUOUS_OR_MISSING');
  if(action==='FOCUS'){await chrome.windows.update(ctx.windowId,{focused:true});return{status:'FOCUSED'};}
  if(action==='LAYOUT'){await chrome.windows.update(ctx.windowId,{left:Number(payload.left),top:Number(payload.top),width:Number(payload.width),height:Number(payload.height),focused:false});return{status:'LAYOUT_APPLIED'};}
  if(action==='CLOSE_WINDOW'){
    await post('/api/window-event',{workerId,event:'CLOSED',windowId:ctx.windowId});
    await chrome.windows.remove(ctx.windowId);
    return{status:'WINDOW_CLOSED'};
  }
  if(action==='NAVIGATE'){
    if(!allowedUrl(payload.url)||!matchesWorker(workerId,payload.url)) throw new Error('BLOCKED_URL');
    await chrome.tabs.update(ctx.tabId,{url:payload.url,active:true}); await waitForTabComplete(ctx.tabId); return{status:'NAVIGATED'};
  }
  if(action==='MODEL_PREFLIGHT'){
    if(workerId!=='NV02')return{status:'MODEL_PREFLIGHT_NOT_REQUIRED'};
    return precheckNv02Profile(ctx,'COMMAND_PREFLIGHT');
  }
  if(action==='DISPATCH'){
    if(!matchesWorker(workerId,ctx.url)) throw new Error('BLOCKED_URL');
    await chrome.tabs.update(ctx.tabId,{active:true});
    if(workerId==='NV02')await precheckNv02Profile(ctx,'COMMAND_DISPATCH');
    const response=await chrome.tabs.sendMessage(ctx.tabId,{type:'TIGERIQ_DISPATCH',text:String(payload.text||''),workerId});
    if(!response?.ok){const reason=response?.status||'DISPATCH_FAILED';const error=new Error(reason);error.status=reason;throw error;}
    return response;
  }
  if(action==='ARCHIVE_CHAT'){
    if(!matchesWorker(workerId,ctx.url)) throw new Error('BLOCKED_URL');
    return runArchiveCommand(workerId,payload,{
      archiveSupported:(id)=>ARCHIVE_SUPPORTED_WORKERS.has(id),
      saveAndArchive,
    });
  }
  throw new Error(`UNKNOWN_ACTION:${action}`);
}


const NV02_CONTINUITY_KEY='nv02ContinuityV1';

async function loadNv02Continuity(){
  const saved=await chrome.storage.local.get([NV02_CONTINUITY_KEY]);
  const now=Date.now();
  const raw=saved[NV02_CONTINUITY_KEY]||{};
  return {
    nextContinueAt:Number(raw.nextContinueAt)||nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS),
    nextRefreshAt:Number(raw.nextRefreshAt)||nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS),
    stalledChecks:Number(raw.stalledChecks)||0,
    lastPrompt:String(raw.lastPrompt||''),
    dispatchesInChat:Number(raw.dispatchesInChat)||0,
    chatStartedAt:Number(raw.chatStartedAt)||now,
    lastPhase:String(raw.lastPhase||'STALLED'),
  };
}
async function saveNv02Continuity(state){await chrome.storage.local.set({[NV02_CONTINUITY_KEY]:state});}
async function emitContinuityEvent(event,data={}){try{await post('/api/continuity/event',{workerId:'NV02',event,...data});}catch{}}

async function dispatchNaturalContinue(ctx,state,now){
  if(ctx.url&&/\/c\//.test(new URL(ctx.url).pathname)){
    try{await chrome.tabs.sendMessage(ctx.tabId,{type:'TIGERIQ_SCROLL_TO_BOTTOM'});}catch{}
  }
  const prompt=pickContinuePrompt(state.lastPrompt);
  await precheckNv02Profile(ctx,'NATURAL_CONTINUE');
  const result=await chrome.tabs.sendMessage(ctx.tabId,{type:'TIGERIQ_DISPATCH',text:prompt,workerId:'NV02'});
  if(!result?.ok)throw new Error(String(result?.status||'CONTINUE_DISPATCH_FAILED'));
  const next={...state,lastPrompt:prompt,dispatchesInChat:state.dispatchesInChat+1,stalledChecks:0,lastPhase:'WORKING',nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
  await saveNv02Continuity(next);
  await emitContinuityEvent('CONTINUE_DISPATCHED',{prompt,evidence:result.evidence||null,nextContinueAt:next.nextContinueAt,dispatchesInChat:next.dispatchesInChat});
  return next;
}

async function checkpointBeforeRefresh(ctx){
  const saveToken=crypto.randomUUID();
  const dispatchedAt=new Date().toISOString();
  const saveText=buildDurableSavePrompt({saveToken,workerId:'NV02',dispatchedAt});
  await precheckNv02Profile(ctx,'REFRESH_CHECKPOINT');
  const save=await chrome.tabs.sendMessage(ctx.tabId,{type:'TIGERIQ_DISPATCH',text:saveText,workerId:'NV02'});
  if(!save?.ok)throw new Error(String(save?.status||'REFRESH_CHECKPOINT_DISPATCH_FAILED'));
  await waitForSaveCompletion(ctx);
  return waitForDurableSaveReceipt(saveToken,'NV02',dispatchedAt);
}

async function rotateNv02Chat(ctx,state,now){
  const archived=await saveAndArchive('NV02',{requireDone:false});
  if(!archived?.ok)throw new Error(String(archived?.status||'ROTATE_ARCHIVE_FAILED'));
  const fresh=await findContext('NV02');
  if(!fresh?.tabId)throw new Error('ROTATE_CONTEXT_MISSING_AFTER_ARCHIVE');
  const opened=await chrome.tabs.sendMessage(fresh.tabId,{type:'TIGERIQ_NEW_CHAT'});
  if(!opened?.ok)throw new Error(String(opened?.status||'ROTATE_NEW_CHAT_FAILED'));
  const next={...state,dispatchesInChat:0,chatStartedAt:now,stalledChecks:0,lastPhase:'READY'};
  await saveNv02Continuity(next);
  await emitContinuityEvent('CHAT_ROTATED',{receiptRef:archived.receiptRef||null,checkpointRef:archived.checkpointRef||null});
  return dispatchNaturalContinue(fresh,next,now);
}

async function maybeNv02Continuity(ctx,ui){
  const now=Date.now();
  let state=await loadNv02Continuity();
  const controller=await get('/api/state');
  const phase=deriveNv02Phase(ui||{});
  state={...state,lastPhase:phase};
  if(phase==='BLOCKED'){
    await saveNv02Continuity(state);
    await emitContinuityEvent('BLOCKED',{securityBlock:ui?.securityBlock||null});
    return;
  }
  if(controller?.paused===true||(controller?.utilityPausedWorkers||[]).includes('NV02')){
    state={...state,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
    await saveNv02Continuity(state);
    await emitContinuityEvent('CONTINUITY_SKIPPED_PAUSED',{nextContinueAt:state.nextContinueAt});
    return;
  }
  const active=hasActiveNv02Work(controller);
  const waitingEvidence=hasWaitingEvidenceNv02Work(controller);
  if(now>=state.nextRefreshAt&&phase==='READY'&&!active&&!waitingEvidence){
    try{
      const receipt=await checkpointBeforeRefresh(ctx);
      const next={...state,nextRefreshAt:nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS),nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS),stalledChecks:0};
      await saveNv02Continuity(next);
      await emitContinuityEvent('REFRESH_SCHEDULED',{receiptRef:receipt?.receiptRef||null,checkpointRef:receipt?.checkpointRef||null,nextRefreshAt:next.nextRefreshAt});
      void post('/api/workers/NV02/restart-schedule',{reason:'RANDOM_2_4H'});
    }catch(error){
      state={...state,nextRefreshAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
      await saveNv02Continuity(state);
      await emitContinuityEvent('REFRESH_DEFERRED',{error:String(error)});
    }
    return;
  }
  if(now<state.nextContinueAt){await saveNv02Continuity(state);return;}
  if(active||phase==='WORKING'){
    state={...state,stalledChecks:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
    await saveNv02Continuity(state);
    await emitContinuityEvent(active?'CONTINUE_SKIPPED_ACTIVE_JOB':'CONTINUE_SKIPPED_WORKING',{nextContinueAt:state.nextContinueAt});
    return;
  }
  if(phase==='READY'){
    try{await dispatchNaturalContinue(ctx,state,now);}
    catch(error){
      state={...state,stalledChecks:Math.min(MAX_STALLED_CHECKS,state.stalledChecks+1),nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
      await saveNv02Continuity(state);
      await emitContinuityEvent('CONTINUE_DISPATCH_FAILED',{error:String(error),stalledChecks:state.stalledChecks});
    }
    return;
  }
  state={...state,stalledChecks:Math.min(MAX_STALLED_CHECKS,state.stalledChecks+1),nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
  await saveNv02Continuity(state);
  await emitContinuityEvent('STALLED_CHECK',{stalledChecks:state.stalledChecks,nextContinueAt:state.nextContinueAt});
  if(state.stalledChecks===2&&ctx?.tabId){
    await chrome.tabs.reload(ctx.tabId);
    await emitContinuityEvent('STALLED_RELOAD',{stalledChecks:state.stalledChecks});
  }else if(state.stalledChecks>=MAX_STALLED_CHECKS){
    void post('/api/workers/NV02/restart-schedule',{reason:'STALLED_3_CHECKS'});
  }
}

async function tickWorker(workerId) {
  const ctx=await findContext(workerId); if(!ctx) return;
  lastWindowByWorker.set(workerId,ctx.windowId);
  await updateWorkerBadge(workerId, ctx);
  const ui=await readUiState(ctx);
  await post('/api/heartbeat',{workerId,state:ui.uiPhase||'STALLED',...ctx,uiBusy:ui.uiBusy,uiPhase:ui.uiPhase,composerReady:ui.composerReady,sendReady:ui.sendReady,stopVisible:ui.stopVisible,scrollToBottomVisible:ui.scrollToBottomVisible,authRequired:ui.authRequired,securityBlock:ui.securityBlock,modelProfileStatus:ui.modelProfileStatus,modelName:ui.modelName,reasoningEffort:ui.reasoningEffort,modelReady:ui.modelReady,modelExact:ui.modelExact,verifiedAt:ui.verifiedAt,blockedReason:ui.blockedReason,display:await displayInfo(ctx.windowId)});
  const r=await fetch(`${CONTROLLER}/api/commands/${encodeURIComponent(workerId)}`); if(!r.ok) return;
  const {command}=await r.json();
  if(command){
    try { const result=await execute(workerId,command); await post('/api/result',{workerId,commandId:command.id,ok:true,...result}); }
    catch(error){ const status=error?.status||String(error?.message||error); await post('/api/result',{workerId,commandId:command.id,ok:false,status}); }
    return;
  }
  // Direct CDP Bridge is the single NV02 continuity owner. Extension stays heartbeat/command-only.
}

async function tick(){
  if(ticking) return; ticking=true;
  try { for(const workerId of await getWorkerIds()) await tickWorker(workerId); }
  catch { /* Controller may be offline; retry later. */ }
  finally { ticking=false; }
}
async function ensureTickAlarm(){ await chrome.alarms.create('tigeriqTick',{periodInMinutes:0.5}); }

chrome.windows.onRemoved.addListener((windowId)=>{
  void (async()=>{
    for(const [workerId,lastWindowId] of lastWindowByWorker){
      if(lastWindowId!==windowId)continue;
      lastWindowByWorker.delete(workerId);
      try{await post('/api/window-event',{workerId,event:'CLOSED',windowId});}catch{/* controller may be restarting */}
    }
  })();
});
chrome.runtime.onInstalled.addListener(async()=>{await ensureTickAlarm();void tick();});
chrome.runtime.onStartup.addListener(async()=>{await ensureTickAlarm();void tick();});
chrome.alarms.onAlarm.addListener((a)=>{if(a.name==='tigeriqTick')void tick();});
chrome.runtime.onMessage.addListener((m,_sender,sendResponse)=>{
  if(m?.type==='TIGERIQ_SAVE_AND_ARCHIVE'){
    void saveAndArchive(String(m.workerId||''),{requireDone:false}).then(sendResponse).catch((error)=>sendResponse({ok:false,status:String(error?.message||error)}));
    return true;
  }
  if(m?.type==='TIGERIQ_CONFIG_UPDATED'||m?.type==='TIGERIQ_ROUTE_CHANGED')void tick();
});
void ensureTickAlarm();
setInterval(()=>void tick(),7000); void tick();