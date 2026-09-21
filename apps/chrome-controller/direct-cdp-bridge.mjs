import fs from 'node:fs';
import http from 'node:http';
import {
  CONTINUE_MIN_MS, CONTINUE_MAX_MS, REFRESH_MIN_MS, REFRESH_MAX_MS,
  MAX_STALLED_CHECKS, deriveNv02Phase, hasActiveNv02Work, hasWaitingEvidenceNv02Work, hasContinuableNv02Work,
  nextRandomAt, pickContinuePrompt,
} from './extension/continuity.js';
import { buildDurableSavePrompt, waitForDurableSaveReceipt } from './extension/save-receipt.js';

const CONFIG='D:\\TigerIQ\\Apps\\ChromeController\\Config\\chrome-controller.json';
const LOG='D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\direct-cdp-bridge.jsonl';
const SEND_BUTTON_WAIT_MS=10000;
const NV02_CONTINUITY_STATE='D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\nv02-continuity-state.json';
const CONTROLLER='http://127.0.0.1:8798';
const BINDING='2';
const NV02_TOKEN=String(process.env.TIGERIQ_NV02_WORKER_TOKEN||'').trim();
const config=JSON.parse(fs.readFileSync(CONFIG,'utf8'));
const NV02_HOME_URL=String(config.workers.find((worker)=>worker.id==='NV02')?.homeUrl||'').trim();
const NV02_PROJECT_PREFIX=(()=>{try{return new URL(NV02_HOME_URL).pathname.replace(/\/project\/?$/,'')}catch{return''}})();
const NV02_PROJECT_ID=(()=>{const m=NV02_PROJECT_PREFIX.match(/^\/g\/(g-p-[a-z0-9]+)(?:-[^/]+)?$/i);return m?.[1]||''})();
const NV02_PROJECT_ID_PREFIX=NV02_PROJECT_ID?`/g/${NV02_PROJECT_ID}`:'';
const busy=new Set();
let nv02VerifiedModelProfile=null;
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
    return Boolean(NV02_PROJECT_ID_PREFIX)&&current.pathname.startsWith(NV02_PROJECT_ID_PREFIX+'/c/');
  }catch{return false}
}

function log(event,data={}){
  const line=JSON.stringify({ts:new Date().toISOString(),event,...data});
  fs.appendFileSync(LOG,line+'\n');
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function loadNv02Continuity(){
  const now=Date.now();
  let raw={};
  try{raw=JSON.parse(fs.readFileSync(NV02_CONTINUITY_STATE,'utf8'));}catch{}
  return {
    nextContinueAt:Number(raw.nextContinueAt)||nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS),
    nextRefreshAt:Number(raw.nextRefreshAt)||nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS),
    stalledChecks:Number(raw.stalledChecks)||0,
    lastPrompt:String(raw.lastPrompt||''),
    dispatchesInChat:Number(raw.dispatchesInChat)||0,
    chatStartedAt:Number(raw.chatStartedAt)||now,
    lastPhase:String(raw.lastPhase||'STALLED'),
    workingSignature:String(raw.workingSignature||''),
    workingUnchangedChecks:Number(raw.workingUnchangedChecks)||0,
  };
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
  async open(){
    this.ws=new WebSocket(this.url);
    await new Promise((ok,fail)=>{this.ws.onopen=ok;this.ws.onerror=fail;});
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
async function pruneDuplicates(w,list){
  const pages=pageTargetsFor(w,list);if(pages.length<=1) return pages[0]||null;
  const homePath=new URL(w.homeUrl).pathname;
  const keep=pages.find(t=>{try{return new URL(t.url).pathname===homePath}catch{return false}})||pages[0];
  const lease=await acquireBridgeMutationLease(w.id);
  if(!lease){log('DUPLICATE_TABS_PRUNE_DEFERRED_LEASE_BUSY',{workerId:w.id,count:pages.length});return keep;}
  const b=await browserRpc(workerPort(w));
  try{
    for(const t of pages){if(t.id!==keep.id) await b.call('Target.closeTarget',{targetId:t.id});}
    log('DUPLICATE_TABS_PRUNED',{workerId:w.id,removed:pages.length-1,kept:keep.id});
  }finally{b.close();await releaseBridgeMutationLease(w.id,lease);}
  return keep;
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
  const stop=[...document.querySelectorAll('button[data-testid="stop-button"],button[aria-label*="Stop" i],button[aria-label*="Dừng" i]')].find(vis)||null;
  const activityBusy=[...document.querySelectorAll('button,[role="button"],[aria-live]')].find(e=>vis(e)&&/(^|\\s)(đang suy nghĩ|thinking|generating|đang tạo)(\\s|$)/i.test((e.getAttribute('aria-label')||e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()))||null;
  const send=composer?[...document.querySelectorAll('button[data-testid="send-button"],button[data-testid="composer-submit-button"],button[type="submit"],button[aria-label*="Gửi" i],button[aria-label*="Send" i]')].find(e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true')||null:null;
  const scroll=[...document.querySelectorAll('button,[role="button"]')].find(e=>vis(e)&&/^(cuộn xuống cuối|scroll to bottom|jump to bottom)$/i.test((e.getAttribute('aria-label')||e.textContent||'').trim()))||null;
  let securityBlock=null;
  if(document.querySelector('iframe[src*="captcha" i],iframe[src*="challenge" i],[class*="captcha" i],[id*="captcha" i]')) securityBlock='BLOCKED_CAPTCHA';
  const txt=[...document.querySelectorAll('[role="alert"],[role="dialog"],[data-testid*="toast" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' ');
  const checks=[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']];
  if(!securityBlock) for(const [n,s] of checks){if(txt.includes(n)){securityBlock=s;break;}}
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
  const uiBusy=Boolean(stop||activityBusy);
  const activityRoot=activityBusy?.closest?.('.block-BQZwFn')||activityBusy?.parentElement||null;
  const activityText=String(activityRoot?.innerText||activityRoot?.textContent||'').replace(/\s+/g,' ').trim();
  let activityHash=0;for(let i=0;i<activityText.length;i+=1)activityHash=((activityHash*31)+activityText.charCodeAt(i))>>>0;
  const activitySignature=uiBusy?(String(activityText.length)+':'+String(activityHash)):'';
  const uiReady=document.readyState==='complete'&&!!composer&&!authRequired;
  const uiPhase=securityBlock?'BLOCKED':uiBusy?'WORKING':uiReady&&modelReady?'READY':'STALLED';
  return {
    uiReady,uiPhase,composerReady:Boolean(composer),sendReady:Boolean(send),stopVisible:Boolean(stop),activityBusyVisible:Boolean(activityBusy),
    scrollToBottomVisible:Boolean(scroll),authRequired,uiBusy,securityBlock,
    modelControlPresent:Boolean(modelControl),modelProfileStatus,modelName,reasoningEffort,modelReady,modelExact,verifiedAt,blockedReason,activitySignature,projectDraftReady,
    title:document.title,url:location.href,readyState:document.readyState,bodyChildren:document.body?.children?.length||0
  };
})()`;

async function uiStateRaw(target){
  const p=await pageRpc(target);
  try{return (await p.call('Runtime.evaluate',{expression:UI_EXPR,returnByValue:true})).result.value;}
  finally{p.close();}
}
async function uiState(target){return applyNv02VerifiedModelProfile(await uiStateRaw(target));}
async function evalPage(target,expression){
  const p=await pageRpc(target);
  try{return (await p.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;}
  finally{p.close();}
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
  await continuityEvent('MODEL_PROFILE_VERIFIED',{modelName:profile.modelName,reasoningEffort:profile.reasoningEffort,verifiedAt:profile.verifiedAt||null});
  return profile;
}
async function post(path,workerId,data){
  const r=await fetch(CONTROLLER+path,{method:'POST',headers:auth(workerId,true),body:JSON.stringify(data),signal:AbortSignal.timeout(4000)});
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
async function navigate(target,url){
  const p=await pageRpc(target);try{await p.call('Page.enable');await p.call('Page.navigate',{url});}finally{p.close();}
}
function projectNewChatExpr(){
  return `(()=>{const labels=['Trò chuyện mới trong TigerIQ AI Lab','New chat in TigerIQ AI Lab'];const matches=[...document.querySelectorAll('button,[role="button"]')].filter(e=>labels.includes((e.getAttribute('aria-label')||'').trim()));if(matches.length!==1)return{ok:false,status:'PROJECT_NEW_CHAT_BUTTON_COUNT_'+matches.length};matches[0].click();return{ok:true,status:'PROJECT_NEW_CHAT_CLICKED'}})()`;
}
async function recoverNv02ProjectContext(target){
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
  return `(async()=>{const text=${JSON.stringify(text)},expected=text.trim();const sleep=ms=>new Promise(r=>setTimeout(r,ms));const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const securityBlock=()=>{if(document.querySelector('iframe[src*=\"captcha\" i],iframe[src*=\"challenge\" i],[class*=\"captcha\" i],[id*=\"captcha\" i]'))return'BLOCKED_CAPTCHA';const t=[...document.querySelectorAll('[role=\"alert\"],[role=\"dialog\"],[data-testid*=\"toast\" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' '),m=[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']];for(const [n,s] of m)if(t.includes(n))return s;return null;};const blocked=securityBlock();if(blocked)return{ok:false,status:blocked};if(!expected)return{ok:false,status:'EMPTY_WORK_ORDER'};const sels=location.hostname==='chatgpt.com'?['#prompt-textarea','div[contenteditable=\"true\"][data-lexical-editor=\"true\"]','[contenteditable=\"true\"][role=\"textbox\"]','textarea']:['rich-textarea .ql-editor[contenteditable=\"true\"]','.ql-editor[contenteditable=\"true\"]','[contenteditable=\"true\"][role=\"textbox\"]','textarea'];const findComposer=()=>{for(const s of sels){const x=[...document.querySelectorAll(s)].find(vis);if(x)return x;}return null;};const composerText=e=>e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement?String(e.value||'').trim():String(e?.innerText||e?.textContent||'').trim();let c=findComposer();if(!c)return{ok:false,status:'COMPOSER_NOT_FOUND'};if(composerText(c)!==expected){c.focus();if(c instanceof HTMLTextAreaElement||c instanceof HTMLInputElement){const proto=c instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(c,text);c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));}else{const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(c);sel?.removeAllRanges();sel?.addRange(range);if(!document.execCommand('insertText',false,text)){c.textContent=text;c.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));}}}const scoped=['button[data-testid=\"send-button\"]','button[data-testid=\"composer-submit-button\"]','button[type=\"submit\"]','button[aria-label*=\"Send\" i]','button[aria-label*=\"Gửi\" i]','button[aria-label*=\"submit\" i]'],global=['button[data-testid=\"send-button\"]','button[data-testid=\"composer-submit-button\"]','button[aria-label*=\"Send\" i]','button[aria-label*=\"Gửi\" i]','button[aria-label*=\"submit\" i]'];const usable=e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';const findSend=()=>{for(const root of [c.closest?.('form'),c.parentElement].filter(Boolean))for(const s of scoped){const a=[...root.querySelectorAll(s)].filter(usable);if(a.length===1)return a[0];}for(const s of global){const a=[...document.querySelectorAll(s)].filter(usable);if(a.length===1)return a[0];}return null;};let b=null,until=Date.now()+${SEND_BUTTON_WAIT_MS};while(Date.now()<until){await sleep(150);const gate=securityBlock();if(gate)return{ok:false,status:gate};b=findSend();if(b)break;}if(!b)return{ok:false,status:'SEND_BUTTON_NOT_FOUND'};b.click();const busy=()=>['button[data-testid=\"stop-button\"]','button[aria-label*=\"Stop\" i]','button[aria-label*=\"Dừng\" i]'].some(s=>[...document.querySelectorAll(s)].some(vis))||[...document.querySelectorAll('button,[role=\"button\"],[aria-live]')].some(e=>vis(e)&&/(^|\\s)(đang suy nghĩ|thinking|generating|đang tạo)(\\s|$)/i.test((e.getAttribute('aria-label')||e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()));until=Date.now()+3500;while(Date.now()<until){await sleep(100);const gate=securityBlock();if(gate)return{ok:false,status:gate};if(busy())return{ok:true,status:'SUBMITTED',evidence:'UI_BUSY'};if(location.hostname==='chatgpt.com'){const expectedNormalized=expected.replace(/\\s+/g,' ').trim();const userSelector='[data-message-author-role=\"user\"],.rich-text-user-turn,[data-user-message-bubble=\"true\"] .rich-text-user-turn,[data-content-search-unit-key$=\":user\"]';if([...document.querySelectorAll(userSelector)].some(e=>vis(e)&&String(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()===expectedNormalized))return{ok:true,status:'SUBMITTED',evidence:'USER_MESSAGE_VISIBLE'};}c=findComposer();if(c&&composerText(c)==='')return{ok:true,status:'SUBMITTED',evidence:'COMPOSER_CLEARED'};}return{ok:false,status:'SUBMIT_EVIDENCE_MISSING'};})()`;
}
function enterSubmitStateExpr(text){
  const expectedNormalized=String(text||'').replace(/\\s+/g,' ').trim();
  return `(()=>{const expected=${JSON.stringify(text.trim())},expectedNormalized=${JSON.stringify(expectedNormalized)};const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const securityBlock=()=>{if(document.querySelector('iframe[src*="captcha" i],iframe[src*="challenge" i],[class*="captcha" i],[id*="captcha" i]'))return'BLOCKED_CAPTCHA';const t=[...document.querySelectorAll('[role="alert"],[role="dialog"],[data-testid*="toast" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' '),m=[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']];for(const [n,x] of m)if(t.includes(n))return x;return null;};const sels=['#prompt-textarea','div[contenteditable="true"][data-lexical-editor="true"]','[contenteditable="true"][role="textbox"]','textarea'];const c=sels.flatMap(x=>[...document.querySelectorAll(x)]).find(vis)||null;const composerText=e=>e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement?String(e.value||'').trim():String(e?.innerText||e?.textContent||'').trim();const busy=['button[data-testid="stop-button"]','button[aria-label*="Stop" i]','button[aria-label*="Dừng" i]'].some(x=>[...document.querySelectorAll(x)].some(vis))||[...document.querySelectorAll('button,[role="button"],[aria-live]')].some(e=>vis(e)&&/(^|\\s)(đang suy nghĩ|thinking|generating|đang tạo)(\\s|$)/i.test((e.getAttribute('aria-label')||e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()));const userSelector='[data-message-author-role="user"],.rich-text-user-turn,[data-user-message-bubble="true"] .rich-text-user-turn,[data-content-search-unit-key$=":user"]';const userVisible=[...document.querySelectorAll(userSelector)].some(e=>vis(e)&&String(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()===expectedNormalized);const current=composerText(c),currentNormalized=current.replace(/\\s+/g,' ').trim();return{securityBlock:securityBlock(),composerMatches:Boolean(c)&&currentNormalized===expectedNormalized,composerEmpty:Boolean(c)&&current==='',busy,userVisible};})()`;
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
async function scrollToBottom(target){const p=await pageRpc(target);try{return (await p.call('Runtime.evaluate',{expression:scrollBottomExpr(),returnByValue:true,userGesture:true})).result.value;}finally{p.close();}}

function archiveMenuPointExpr(){return `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const vis=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};if(!/\\/c\\//.test(location.pathname))return{ok:false,status:'ARCHIVE_REQUIRES_CONVERSATION_URL'};const before=location.href,title=document.title.trim();const open=[...document.querySelectorAll('button,[role="button"]')].find(e=>vis(e)&&/mở sidebar|hiện thanh bên|open sidebar/i.test((e.getAttribute('aria-label')||e.innerText||'').trim()));if(open){open.click();await sleep(450)}const rows=[...document.querySelectorAll('[role="listitem"]')].filter(e=>vis(e)&&String(e.innerText||'').trim()===title);const exact=rows.filter(row=>[...row.querySelectorAll('button')].some(b=>/hành động trong trò chuyện|conversation actions|chat actions/i.test(b.getAttribute('aria-label')||'')));if(exact.length!==1)return{ok:false,status:'ARCHIVE_CURRENT_ROW_COUNT_'+exact.length,title};const menu=[...exact[0].querySelectorAll('button')].filter(b=>vis(b)&&/hành động trong trò chuyện|conversation actions|chat actions/i.test(b.getAttribute('aria-label')||''));if(menu.length!==1)return{ok:false,status:'ARCHIVE_MENU_BUTTON_COUNT_'+menu.length,title};const r=menu[0].getBoundingClientRect();return{ok:true,status:'ARCHIVE_MENU_POINT',before,title,x:r.left+r.width/2,y:r.top+r.height/2}})()`; }
function archiveItemPointExpr(){return `(()=>{const vis=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const items=[...document.querySelectorAll('[role="menuitem"]')].filter(vis).filter(e=>/^(archive|lưu trữ)$/i.test((e.innerText||e.textContent||e.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim()));if(items.length!==1)return{ok:false,status:'ARCHIVE_ACTION_COUNT_'+items.length};const r=items[0].getBoundingClientRect();return{ok:true,status:'ARCHIVE_ACTION_POINT',x:r.left+r.width/2,y:r.top+r.height/2,text:(items[0].innerText||items[0].textContent||'').trim()}})()`; }
async function cdpMouseClick(p,point){
  await p.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:Number(point.x),y:Number(point.y),button:'none'});
  await p.call('Input.dispatchMouseEvent',{type:'mousePressed',x:Number(point.x),y:Number(point.y),button:'left',clickCount:1});
  await p.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:Number(point.x),y:Number(point.y),button:'left',clickCount:1});
}
function archiveConfirmExpr(title){
  const expected=JSON.stringify(String(title||''));
  return `(()=>{const vis=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const rows=[...document.querySelectorAll('[role="listitem"]')].filter(e=>vis(e)&&[...e.querySelectorAll('button')].some(b=>/hành động trong trò chuyện|conversation actions|chat actions/i.test(b.getAttribute('aria-label')||'')));const current=rows.filter(row=>String(row.innerText||'').trim()===${expected});return{url:location.href,path:location.pathname,visibleChatRows:rows.length,currentTitleRows:current.length}})()`;
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
      const state=(await p.call('Runtime.evaluate',{expression:archiveConfirmExpr(menuPoint.title),returnByValue:true},3000)).result.value;
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

async function reloadTarget(target){const p=await pageRpc(target);try{await p.call('Page.reload',{ignoreCache:false});return{ok:true,status:'RELOADED'};}finally{p.close();}}
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
  const lease=await acquireBridgeMutationLease('NV02',purpose,ttlMs);
  if(!lease)return{ok:false,status:'MUTATION_LEASE_BUSY'};
  try{return await fn();}finally{await releaseBridgeMutationLease('NV02',lease);}
}
async function dispatchNaturalContinueLocked(target,state,now,resumeJobId=null){
  await ensureNv02ModelProfile(target);
  let recoveryReserved=false;
  if(resumeJobId){
    await post('/api/utility/workers/NV02/job/recovery-resume','NV02',{jobId:resumeJobId});
    recoveryReserved=true;
  }
  try{
    await scrollToBottom(target).catch(()=>{});
    const prompt=pickContinuePrompt(state.lastPrompt);
    const result=await dispatch(target,prompt);
    if(!result?.ok)throw new Error(result?.status||'CONTINUE_DISPATCH_FAILED');
    const next={...state,lastPrompt:prompt,dispatchesInChat:Number(state.dispatchesInChat||0)+1,stalledChecks:0,lastPhase:'WORKING',nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
    saveNv02Continuity(next);
    if(resumeJobId)await continuityEvent('WAITING_EVIDENCE_RESUMED',{jobId:resumeJobId,prompt,evidence:result.evidence||null});
    await continuityEvent('CONTINUE_DISPATCHED',{prompt,evidence:result.evidence||null,nextContinueAt:next.nextContinueAt,dispatchesInChat:next.dispatchesInChat});
    return next;
  }catch(error){
    if(recoveryReserved){
      await post('/api/utility/workers/NV02/job','NV02',{
        jobId:resumeJobId,
        stage:'WAITING_EVIDENCE',
        nextAction:'Retry same-job recovery continue',
        blocker:'RECOVERY_CONTINUE_NOT_DELIVERED',
      }).catch(()=>{});
    }
    throw error;
  }
}
async function dispatchNaturalContinue(target,state,now,resumeJobId=null){
  return withNv02Mutation(()=>dispatchNaturalContinueLocked(target,state,now,resumeJobId),'CONTINUITY_CONTINUE');
}
async function checkpointNv02(target){
  return withNv02Mutation(async()=>{
    await ensureNv02ModelProfile(target);
    const saveToken=crypto.randomUUID(),dispatchedAt=new Date().toISOString();
    const text=buildDurableSavePrompt({saveToken,workerId:'NV02',dispatchedAt});
    const sent=await dispatch(target,text);
    if(!sent?.ok)throw new Error(sent?.status||'SAVE_DISPATCH_FAILED');
    const receipt=await waitForDurableSaveReceipt(saveToken,'NV02',dispatchedAt);
    await waitForIdleAfterSubmission(target,45000,5000);
    await continuityEvent('CHECKPOINT_DURABLE',{receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,verifiedAt:receipt.verifiedAt});
    return receipt;
  },'CHECKPOINT_DURABLE',120000);
}
async function rotateNv02Chat(target,state,now){
  const receipt=await checkpointNv02(target);
  const checkpointed={...state,dispatchesInChat:0,chatStartedAt:now,stalledChecks:0,lastPhase:'READY',nextRefreshAt:nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS)};
  saveNv02Continuity(checkpointed);
  return withNv02Mutation(async()=>{
    const archived=await archiveChat(target);if(!archived?.ok)throw new Error(archived?.status||'ROTATE_ARCHIVE_FAILED');
    await continuityEvent('ARCHIVE_CONFIRMED',{receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,archiveStatus:archived.status});
    const opened=await newChat(target);if(!opened?.ok)throw new Error(opened?.status||'ROTATE_NEW_CHAT_FAILED');
    await continuityEvent('NEW_CHAT_CREATED',{newChatStatus:opened.status});
    const freshUi=await ensureNv02ModelProfile(target);
    if(freshUi?.securityBlock)throw new Error(freshUi.securityBlock);
    if(freshUi?.modelExact!==true||freshUi?.uiPhase!=='READY')throw new Error('ROTATE_MODEL_PROFILE_NOT_READY');
    const next={...checkpointed,lastPhase:'READY'};
    saveNv02Continuity(next);
    await continuityEvent('CHAT_ROTATED',{receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,archiveStatus:archived.status,newChatStatus:opened.status,nextRefreshAt:next.nextRefreshAt});
    return dispatchNaturalContinueLocked(target,next,now);
  },'CHAT_ROTATION',60000);
}
async function noteNv02CommandDispatch(){
  const state=loadNv02Continuity();
  state.dispatchesInChat=Number(state.dispatchesInChat||0)+1;
  saveNv02Continuity(state);
}
async function maybeNv02Continuity(w,target,ui){
  const now=Date.now();let state=loadNv02Continuity();
  const phase=deriveNv02Phase(ui||{});
  state={...state,lastPhase:phase};saveNv02Continuity(state);
  if(phase==='BLOCKED'){await continuityEvent('BLOCKED',{securityBlock:ui?.securityBlock||null});return;}
  const controller=await getControllerState();
  if(controller?.paused===true||(controller?.utilityPausedWorkers||[]).includes('NV02')){
    if(now>=state.nextContinueAt){
      state={...state,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
      await continuityEvent('CONTINUE_SKIPPED_OWNER_READ_ONLY',{nextContinueAt:state.nextContinueAt});
    }
    return;
  }
  const active=hasActiveNv02Work(controller);
  const waitingEvidence=hasWaitingEvidenceNv02Work(controller);
  const continuable=hasContinuableNv02Work(controller);
  const waitingEvidenceJobId=String((controller?.jobs||[]).find((job)=>job?.workerId==='NV02'&&job?.stage==='WAITING_EVIDENCE'&&!job?.completedAt)?.jobId||'')||null;
  if(now>=state.nextRefreshAt&&phase==='READY'&&!active&&!waitingEvidence){
    try{
      const receipt=await checkpointNv02(target);
      state={...state,nextRefreshAt:nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS),nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS),stalledChecks:0};
      saveNv02Continuity(state);
      await continuityEvent('REFRESH_SCHEDULED',{receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,nextRefreshAt:state.nextRefreshAt});
      await post('/api/workers/NV02/restart-schedule','NV02',{reason:'RANDOM_2_4H'});
    }catch(error){
      state={...state,nextRefreshAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
      await continuityEvent('REFRESH_DEFERRED',{error:String(error?.message||error)});
    }
    return;
  }
  if(now<state.nextContinueAt)return;
  const currentTrackedWork=continuable;
  if(phase==='WORKING'){
    if(!currentTrackedWork){
      state={...state,stalledChecks:0,workingSignature:'',workingUnchangedChecks:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
      await continuityEvent('CONTINUE_SKIPPED_UNTRACKED_WORKING',{nextContinueAt:state.nextContinueAt});
      return;
    }
    const signature=String(ui?.activitySignature||'');
    const same=Boolean(signature&&state.workingSignature===signature);
    const unchanged=same?Math.min(MAX_STALLED_CHECKS,Number(state.workingUnchangedChecks||0)+1):1;
    state={...state,stalledChecks:0,workingSignature:signature,workingUnchangedChecks:unchanged,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
    await continuityEvent('WORKING_NO_PROGRESS_CHECK',{workingUnchangedChecks:unchanged,nextContinueAt:state.nextContinueAt,signaturePresent:Boolean(signature)});
    if(unchanged===2){
      const result=await withNv02Mutation(()=>reloadTarget(target),'STALE_WORKING_RECOVERY');
      await continuityEvent('WORKING_STALE_RELOAD',{status:result?.status||null,workingUnchangedChecks:unchanged});
    }else if(unchanged>=MAX_STALLED_CHECKS){
      await post('/api/workers/NV02/restart-schedule','NV02',{reason:'WORKING_NO_PROGRESS_3_CHECKS'}).catch(async error=>continuityEvent('WORKING_STALE_RESTART_FAILED',{error:String(error?.message||error)}));
    }else{
      await continuityEvent('CONTINUE_SKIPPED_WORKING',{nextContinueAt:state.nextContinueAt});
    }
    return;
  }
  if(active&&!continuable){
    state={...state,stalledChecks:0,workingSignature:'',workingUnchangedChecks:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
    await continuityEvent('CONTINUE_SKIPPED_NONCONTINUABLE_ACTIVE_JOB',{nextContinueAt:state.nextContinueAt});
    return;
  }
  if(phase==='READY'){
    if(!continuable){
      state={...state,stalledChecks:0,workingSignature:'',workingUnchangedChecks:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
      await continuityEvent('CONTINUE_SKIPPED_NO_CURRENT_WORK',{nextContinueAt:state.nextContinueAt});
      return;
    }
    const sent=await dispatchNaturalContinue(target,state,now,waitingEvidenceJobId);
    if(sent?.status==='MUTATION_LEASE_BUSY'){
      state={...state,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
      await continuityEvent('CONTINUE_SKIPPED_LEASE_BUSY',{nextContinueAt:state.nextContinueAt});
    }
    return;
  }
  if(!currentTrackedWork){
    state={...state,stalledChecks:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
    await continuityEvent(active?'RECOVERY_SKIPPED_NONCONTINUABLE_ACTIVE_JOB':'RECOVERY_SKIPPED_NO_CURRENT_WORK',{nextContinueAt:state.nextContinueAt});
    return;
  }
  if(ui?.modelExact!==true){
    try{
      const corrected=await withNv02Mutation(()=>ensureNv02ModelProfile(target),'MODEL_PROFILE_RECOVERY');
      await continuityEvent('MODEL_PROFILE_RECOVERY',{status:corrected?.status||corrected?.modelProfileStatus||'VERIFIED',modelName:corrected?.modelName||null,reasoningEffort:corrected?.reasoningEffort||null});
      if(corrected?.status==='MUTATION_LEASE_BUSY'){
        state={...state,stalledChecks:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
        return;
      }
      const recoveredProjectContext=isNv02ProjectContext(corrected?.url)||corrected?.projectDraftReady===true;
      if(!recoveredProjectContext)throw new Error('PROJECT_CONTEXT_NOT_READY_AFTER_MODEL_RECOVERY');
      await postWorkerHeartbeat(w,target,corrected,recoveredProjectContext);
      await continuityEvent('MODEL_PROFILE_HEARTBEAT_REFRESHED',{modelName:corrected?.modelName||null,reasoningEffort:corrected?.reasoningEffort||null,verifiedAt:corrected?.verifiedAt||null});
      state={...state,stalledChecks:0,nextContinueAt:now};saveNv02Continuity(state);
      const sent=await dispatchNaturalContinue(target,state,now,waitingEvidenceJobId);
      if(sent?.status==='MUTATION_LEASE_BUSY'){
        state={...state,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
      }
      return;
    }catch(error){await continuityEvent('MODEL_PROFILE_RECOVERY_FAILED',{error:String(error?.message||error)});}
  }
  state={...state,stalledChecks:Math.min(MAX_STALLED_CHECKS,state.stalledChecks+1),nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
  await continuityEvent('STALLED_CHECK',{stalledChecks:state.stalledChecks,nextContinueAt:state.nextContinueAt,modelReady:ui?.modelReady??null,reasoningEffort:ui?.reasoningEffort??null});
  if(state.stalledChecks===2){
    const result=await withNv02Mutation(()=>reloadTarget(target),'STALLED_RECOVERY');
    await continuityEvent('STALLED_RELOAD',{status:result?.status||null});
  }else if(state.stalledChecks>=MAX_STALLED_CHECKS&&currentTrackedWork){
    try{
      await rotateNv02Chat(target,state,now);
      await continuityEvent('CONTEXT_RECOVERY_ROTATED',{stalledChecks:state.stalledChecks});
    }catch(error){
      await continuityEvent('CONTEXT_RECOVERY_ROTATE_FAILED',{error:String(error?.message||error),stalledChecks:state.stalledChecks});
      await post('/api/workers/NV02/restart-schedule','NV02',{reason:'STALLED_3_CHECKS'}).catch(async restartError=>continuityEvent('STALLED_RESTART_FAILED',{error:String(restartError?.message||restartError)}));
    }
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
  await post('/api/heartbeat',w.id,{workerId:w.id,state:ui.uiPhase||'STALLED',windowId,tabId:target.id,url:ui.url,active:true,uiReady:ui.uiReady,uiPhase:ui.uiPhase,composerReady:ui.composerReady,sendReady:ui.sendReady,stopVisible:ui.stopVisible,scrollToBottomVisible:ui.scrollToBottomVisible,authRequired:ui.authRequired===true,uiBusy:ui.uiBusy,securityBlock:ui.securityBlock,modelControlPresent:ui.modelControlPresent,modelProfileStatus:ui.modelProfileStatus,modelName:ui.modelName,reasoningEffort:ui.reasoningEffort,modelReady:ui.modelReady,modelExact:ui.modelExact,verifiedAt:ui.verifiedAt,blockedReason:ui.blockedReason,projectContextReady,display});
}

async function tickWorker(w){
  if(busy.has(w.id)) return; busy.add(w.id);
  try{
    const port=workerPort(w);let list=await targets(port);let target=await pruneDuplicates(w,list);if(!target)return;
    const rawUi=await uiState(target);
    const projectContextReady=w.id!=='NV02'||isNv02ProjectContext(rawUi.url)||rawUi.projectDraftReady===true;
    const ui=projectContextReady?rawUi:{...rawUi,uiReady:false,uiPhase:'STALLED',modelReady:false};
    await postWorkerHeartbeat(w,target,ui,projectContextReady);
    if(w.id==='NV02'&&!projectContextReady&&!ui.securityBlock){
      if(!NV02_HOME_URL){await continuityEvent('PROJECT_CONTEXT_RECOVERY_BLOCKED',{reason:'NV02_HOME_URL_MISSING',url:rawUi.url||null});return;}
      const recovered=await withNv02Mutation(()=>recoverNv02ProjectContext(target),'PROJECT_CONTEXT_RECOVERY');
      await continuityEvent(recovered?.status==='MUTATION_LEASE_BUSY'?'PROJECT_CONTEXT_RECOVERY_DEFERRED':'PROJECT_CONTEXT_RECOVERY_NAVIGATED',{status:recovered?.status||null,fromUrl:rawUi.url||null});
      return;
    }
    const command=await getCommand(w.id);
    if(command){
      try{
        const result=await handleCommand(w,target,command);
        await post('/api/result',w.id,{workerId:w.id,commandId:command.id,ok:true,...result});
        if(w.id==='NV02'&&command.action==='DISPATCH')noteNv02CommandDispatch();
      }catch(error){await post('/api/result',w.id,{workerId:w.id,commandId:command.id,ok:false,status:String(error?.message||error)}).catch(()=>{});}
      return;
    }
    if(w.id==='NV02')await maybeNv02Continuity(w,target,ui);
  }catch(error){
    const msg=String(error?.message||error);
    if(!/fetch failed|ECONNREFUSED|CDP_LIST|AbortError|TimeoutError/.test(msg)) log('WORKER_TICK_ERROR',{workerId:w.id,error:msg});
  }finally{busy.delete(w.id);}
}

async function tick(){await Promise.all(config.workers.filter(w=>w.enabled!==false&&w.id==='NV02').map(tickWorker));}
http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,workers:config.workers.map(w=>w.id)}));return;}res.writeHead(404);res.end();}).listen(8799,'127.0.0.1',()=>log('BRIDGE_READY',{port:8799}));
setInterval(()=>void tick(),3000).unref();
void tick();
