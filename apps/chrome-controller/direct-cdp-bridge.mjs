import fs from 'node:fs';
import http from 'node:http';
import {
  CONTINUE_MIN_MS, CONTINUE_MAX_MS, REFRESH_MIN_MS, REFRESH_MAX_MS,
  MAX_STALLED_CHECKS, deriveNv02Phase, hasActiveNv02Work,
  nextRandomAt, pickContinuePrompt, shouldRotateChat,
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
const busy=new Set();

function isNv02ProjectContext(url){
  if(!NV02_PROJECT_PREFIX)return false;
  try{
    const current=new URL(String(url||''));
    const expected=new URL(NV02_HOME_URL);
    return current.hostname===expected.hostname&&(current.pathname===expected.pathname||current.pathname.startsWith(NV02_PROJECT_PREFIX+'/c/'));
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
  const modelControl=location.hostname==='chatgpt.com'?[...document.querySelectorAll('button,[role="button"]')].find(e=>vis(e)&&/chọn mô hình chatgpt|choose.*model|model selector/i.test((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'')))||null:null;
  const reasoningEffort=modelControl?.getAttribute('data-selected-reasoning-effort')||null;
  const modelReady=location.hostname!=='chatgpt.com'||Boolean(modelControl&&String(reasoningEffort||'').toLowerCase()==='high');
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
    modelControlPresent:Boolean(modelControl),reasoningEffort,modelReady,activitySignature,projectDraftReady,
    title:document.title,url:location.href,readyState:document.readyState,bodyChildren:document.body?.children?.length||0
  };
})()`;

async function uiState(target){
  const p=await pageRpc(target);
  try{return (await p.call('Runtime.evaluate',{expression:UI_EXPR,returnByValue:true})).result.value;}
  finally{p.close();}
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
  if(r.status===409)return null;
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
  return `(async()=>{const text=${JSON.stringify(text)},expected=text.trim();const sleep=ms=>new Promise(r=>setTimeout(r,ms));const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const securityBlock=()=>{if(document.querySelector('iframe[src*=\"captcha\" i],iframe[src*=\"challenge\" i],[class*=\"captcha\" i],[id*=\"captcha\" i]'))return'BLOCKED_CAPTCHA';const t=[...document.querySelectorAll('[role=\"alert\"],[role=\"dialog\"],[data-testid*=\"toast\" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' '),m=[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']];for(const [n,s] of m)if(t.includes(n))return s;return null;};const blocked=securityBlock();if(blocked)return{ok:false,status:blocked};if(!expected)return{ok:false,status:'EMPTY_WORK_ORDER'};const sels=location.hostname==='chatgpt.com'?['#prompt-textarea','div[contenteditable=\"true\"][data-lexical-editor=\"true\"]','[contenteditable=\"true\"][role=\"textbox\"]','textarea']:['rich-textarea .ql-editor[contenteditable=\"true\"]','.ql-editor[contenteditable=\"true\"]','[contenteditable=\"true\"][role=\"textbox\"]','textarea'];const findComposer=()=>{for(const s of sels){const x=[...document.querySelectorAll(s)].find(vis);if(x)return x;}return null;};const composerText=e=>e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement?String(e.value||'').trim():String(e?.innerText||e?.textContent||'').trim();let c=findComposer();if(!c)return{ok:false,status:'COMPOSER_NOT_FOUND'};if(composerText(c)!==expected){c.focus();if(c instanceof HTMLTextAreaElement||c instanceof HTMLInputElement){const proto=c instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(c,text);c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));}else{const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(c);sel?.removeAllRanges();sel?.addRange(range);if(!document.execCommand('insertText',false,text)){c.textContent=text;c.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));}}}const scoped=['button[data-testid=\"send-button\"]','button[data-testid=\"composer-submit-button\"]','button[type=\"submit\"]','button[aria-label*=\"Send\" i]','button[aria-label*=\"Gửi\" i]','button[aria-label*=\"submit\" i]'],global=['button[data-testid=\"send-button\"]','button[data-testid=\"composer-submit-button\"]','button[aria-label*=\"Send\" i]','button[aria-label*=\"Gửi\" i]','button[aria-label*=\"submit\" i]'];const usable=e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';const findSend=()=>{for(const root of [c.closest?.('form'),c.parentElement].filter(Boolean))for(const s of scoped){const a=[...root.querySelectorAll(s)].filter(usable);if(a.length===1)return a[0];}for(const s of global){const a=[...document.querySelectorAll(s)].filter(usable);if(a.length===1)return a[0];}return null;};let b=null,until=Date.now()+${SEND_BUTTON_WAIT_MS};while(Date.now()<until){await sleep(150);const gate=securityBlock();if(gate)return{ok:false,status:gate};b=findSend();if(b)break;}if(!b)return{ok:false,status:'SEND_BUTTON_NOT_FOUND'};b.click();const busy=()=>['button[data-testid=\"stop-button\"]','button[aria-label*=\"Stop\" i]','button[aria-label*=\"Dừng\" i]'].some(s=>[...document.querySelectorAll(s)].some(vis))||[...document.querySelectorAll('button,[role=\"button\"],[aria-live]')].some(e=>vis(e)&&/(^|\\s)(đang suy nghĩ|thinking|generating|đang tạo)(\\s|$)/i.test((e.getAttribute('aria-label')||e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()));until=Date.now()+3500;while(Date.now()<until){await sleep(100);const gate=securityBlock();if(gate)return{ok:false,status:gate};if(busy())return{ok:true,status:'SUBMITTED',evidence:'UI_BUSY'};if(location.hostname==='chatgpt.com'&&[...document.querySelectorAll('[data-message-author-role=\"user\"]')].some(e=>vis(e)&&String(e.textContent||'').trim()===expected))return{ok:true,status:'SUBMITTED',evidence:'USER_MESSAGE_VISIBLE'};c=findComposer();if(c&&composerText(c)==='')return{ok:true,status:'SUBMITTED',evidence:'COMPOSER_CLEARED'};}return{ok:false,status:'SUBMIT_EVIDENCE_MISSING'};})()`;
}
async function dispatch(target,text){
  const p=await pageRpc(target);
  try{return (await p.call('Runtime.evaluate',{expression:dispatchExpr(text),awaitPromise:true,returnByValue:true,userGesture:true},SEND_BUTTON_WAIT_MS+6000)).result.value;}
  finally{p.close();}
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
async function newChat(target){
  const p=await pageRpc(target);
  try{
    const first=(await p.call('Runtime.evaluate',{expression:newChatExpr(),awaitPromise:true,returnByValue:true,userGesture:true},12000)).result.value;
    if(!first?.ok)return first;
    if(!NV02_HOME_URL)return{ok:false,status:'NV02_HOME_URL_MISSING'};
    const expected=new URL(NV02_HOME_URL);
    const current=(await p.call('Runtime.evaluate',{expression:'({url:location.href,pathname:location.pathname})',returnByValue:true},3000)).result.value;
    if(current?.pathname===expected.pathname)return first;
    await p.call('Page.navigate',{url:NV02_HOME_URL});
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){
      await sleep(250);
      try{
        const state=(await p.call('Runtime.evaluate',{expression:`(()=>{const v=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return !!e&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};return{url:location.href,pathname:location.pathname,composer:Boolean([...document.querySelectorAll('#prompt-textarea,[contenteditable="true"][role="textbox"],textarea')].find(v))}})()`,returnByValue:true},3000)).result.value;
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
async function dispatchNaturalContinueLocked(target,state,now){
  await scrollToBottom(target).catch(()=>{});
  const prompt=pickContinuePrompt(state.lastPrompt);
  const result=await dispatch(target,prompt);
  if(!result?.ok)throw new Error(result?.status||'CONTINUE_DISPATCH_FAILED');
  const next={...state,lastPrompt:prompt,dispatchesInChat:Number(state.dispatchesInChat||0)+1,stalledChecks:0,lastPhase:'WORKING',nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};
  saveNv02Continuity(next);
  await continuityEvent('CONTINUE_DISPATCHED',{prompt,evidence:result.evidence||null,nextContinueAt:next.nextContinueAt,dispatchesInChat:next.dispatchesInChat});
  return next;
}
async function dispatchNaturalContinue(target,state,now){
  return withNv02Mutation(()=>dispatchNaturalContinueLocked(target,state,now),'CONTINUITY_CONTINUE');
}
async function checkpointNv02(target){
  return withNv02Mutation(async()=>{
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
  return withNv02Mutation(async()=>{
    const archived=await archiveChat(target);if(!archived?.ok)throw new Error(archived?.status||'ROTATE_ARCHIVE_FAILED');
    const opened=await newChat(target);if(!opened?.ok)throw new Error(opened?.status||'ROTATE_NEW_CHAT_FAILED');
    const freshUi=await uiState(target);
    if(freshUi?.securityBlock)throw new Error(freshUi.securityBlock);
    if(freshUi?.modelReady!==true||freshUi?.uiPhase!=='READY')throw new Error('ROTATE_MODEL_PROFILE_NOT_READY');
    const next={...state,dispatchesInChat:0,chatStartedAt:now,stalledChecks:0,lastPhase:'READY'};
    saveNv02Continuity(next);
    await continuityEvent('CHAT_ROTATED',{receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,archiveStatus:archived.status,newChatStatus:opened.status});
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
  const active=hasActiveNv02Work(controller);
  if(now>=state.nextRefreshAt&&phase==='READY'&&!active){
    try{
      const receipt=await checkpointNv02(target);
      state={...state,nextRefreshAt:nextRandomAt(now,REFRESH_MIN_MS,REFRESH_MAX_MS),nextContinueAt:now+15000,stalledChecks:0};
      saveNv02Continuity(state);
      await continuityEvent('REFRESH_SCHEDULED',{receiptRef:receipt.receiptRef,checkpointRef:receipt.checkpointRef,nextRefreshAt:state.nextRefreshAt});
      await post('/api/workers/NV02/restart-schedule','NV02',{reason:'RANDOM_2_4H'});
    }catch(error){
      state={...state,nextRefreshAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
      await continuityEvent('REFRESH_DEFERRED',{error:String(error?.message||error)});
    }
    return;
  }
  if(phase==='READY'&&!active&&now>=state.nextContinueAt&&shouldRotateChat(state,now)){
    try{await rotateNv02Chat(target,state,now);}
    catch(error){
      state={...state,stalledChecks:Math.min(MAX_STALLED_CHECKS,state.stalledChecks+1),nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
      await continuityEvent('CHAT_ROTATE_FAILED',{error:String(error?.message||error),stalledChecks:state.stalledChecks});
    }
    return;
  }
  if(now<state.nextContinueAt)return;
  if(active){
    state={...state,stalledChecks:0,workingSignature:'',workingUnchangedChecks:0,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
    await continuityEvent('CONTINUE_SKIPPED_ACTIVE_JOB',{nextContinueAt:state.nextContinueAt});
    return;
  }
  if(phase==='WORKING'){
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
  if(phase==='READY'){
    const sent=await dispatchNaturalContinue(target,state,now);
    if(sent?.status==='MUTATION_LEASE_BUSY'){
      state={...state,nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
      await continuityEvent('CONTINUE_SKIPPED_LEASE_BUSY',{nextContinueAt:state.nextContinueAt});
    }
    return;
  }
  state={...state,stalledChecks:Math.min(MAX_STALLED_CHECKS,state.stalledChecks+1),nextContinueAt:nextRandomAt(now,CONTINUE_MIN_MS,CONTINUE_MAX_MS)};saveNv02Continuity(state);
  await continuityEvent('STALLED_CHECK',{stalledChecks:state.stalledChecks,nextContinueAt:state.nextContinueAt,modelReady:ui?.modelReady??null,reasoningEffort:ui?.reasoningEffort??null});
  if(state.stalledChecks===2){
    const result=await withNv02Mutation(()=>reloadTarget(target));
    await continuityEvent('STALLED_RELOAD',{status:result?.status||null});
  }else if(state.stalledChecks>=MAX_STALLED_CHECKS&&!active){
    await post('/api/workers/NV02/restart-schedule','NV02',{reason:'STALLED_3_CHECKS'}).catch(async error=>continuityEvent('STALLED_RESTART_FAILED',{error:String(error?.message||error)}));
  }
}

async function handleCommand(w,target,command){
  const {action,payload={}}=command;
  if(action==='FOCUS') return focus(target).then(()=>({status:'FOCUSED'}));
  if(action==='LAYOUT') return layout(w,target,payload).then(()=>({status:'LAYOUT_APPLIED'}));
  if(action==='CLOSE_WINDOW') return closeWorker(w,target).then(()=>({status:'WINDOW_CLOSED'}));
  if(action==='NAVIGATE'){const u=new URL(String(payload.url||''));if(u.hostname!==expectedHost(w))throw new Error('BLOCKED_URL');await navigate(target,u.toString());return{status:'NAVIGATED'};}
  if(action==='DISPATCH'){const r=await dispatch(target,String(payload.text||''));if(!r?.ok)throw new Error(r?.status||'DISPATCH_FAILED');return r;}
  if(action==='ARCHIVE_CHAT'){const r=await archiveChat(target);if(!r?.ok)throw new Error(r?.status||'ARCHIVE_FAILED');return r;}
  throw new Error(`UNKNOWN_ACTION:${action}`);
}
async function tickWorker(w){
  if(busy.has(w.id)) return; busy.add(w.id);
  try{
    const port=workerPort(w);let list=await targets(port);let target=await pruneDuplicates(w,list);if(!target)return;
    const rawUi=await uiState(target);const windowId=await windowIdFor(port,target.id);
    const projectContextReady=w.id!=='NV02'||isNv02ProjectContext(rawUi.url)||rawUi.projectDraftReady===true;
    const ui=projectContextReady?rawUi:{...rawUi,uiReady:false,uiPhase:'STALLED',modelReady:false};
    const display={workArea:{left:0,top:0,width:Number(config.layout?.fallbackWorkAreaWidth||3277),height:1688}};
    await post('/api/heartbeat',w.id,{workerId:w.id,state:ui.uiPhase||'STALLED',windowId,tabId:target.id,url:ui.url,active:true,uiReady:ui.uiReady,uiPhase:ui.uiPhase,composerReady:ui.composerReady,sendReady:ui.sendReady,stopVisible:ui.stopVisible,scrollToBottomVisible:ui.scrollToBottomVisible,authRequired:ui.authRequired===true,uiBusy:ui.uiBusy,securityBlock:ui.securityBlock,modelControlPresent:ui.modelControlPresent,reasoningEffort:ui.reasoningEffort,modelReady:ui.modelReady,projectContextReady,display});
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
