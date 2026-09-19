import fs from 'node:fs';
import http from 'node:http';

const CONFIG='D:\\TigerIQ\\Apps\\ChromeController\\Config\\chrome-controller.json';
const LOG='D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\direct-cdp-bridge.jsonl';
const CONTROLLER='http://127.0.0.1:8798';
const BINDING='2';
const NV02_TOKEN=String(process.env.TIGERIQ_NV02_WORKER_TOKEN||'').trim();
const config=JSON.parse(fs.readFileSync(CONFIG,'utf8'));
const busy=new Set();

function log(event,data={}){
  const line=JSON.stringify({ts:new Date().toISOString(),event,...data});
  fs.appendFileSync(LOG,line+'\n');
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
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
  const authRequired=[...document.querySelectorAll('button,a')].some(e=>vis(e)&&/^(đăng nhập|sign in|log in)$/i.test((e.textContent||'').trim()));
  const busySels=location.hostname==='chatgpt.com'
    ? ['button[data-testid="stop-button"]','button[aria-label*="Stop" i]','button[aria-label*="Dừng" i]']
    : ['button[aria-label*="Stop" i]','button[aria-label*="Dừng" i]','button[data-test-id*="stop" i]'];
  const uiBusy=busySels.some(s=>[...document.querySelectorAll(s)].some(vis));
  let securityBlock=null;
  if(document.querySelector('iframe[src*="captcha" i],iframe[src*="challenge" i],[class*="captcha" i],[id*="captcha" i]')) securityBlock='BLOCKED_CAPTCHA';
  const txt=[...document.querySelectorAll('[role="alert"],[role="dialog"],[data-testid*="toast" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' ');
  const checks=[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']];
  if(!securityBlock) for(const [n,s] of checks){if(txt.includes(n)){securityBlock=s;break;}}
  return {uiReady:document.readyState==='complete'&&!!composer&&!authRequired,authRequired,uiBusy,securityBlock,title:document.title,url:location.href,readyState:document.readyState,bodyChildren:document.body?.children?.length||0};
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
async function acquireBridgeMutationLease(workerId){
  const ownerId=`DIRECT_CDP_BRIDGE:${process.pid}:${workerId}`;
  const r=await fetch(`${CONTROLLER}/api/utility/workers/${workerId}/mutation-lease/acquire`,{
    method:'POST',headers:auth(workerId,true),body:JSON.stringify({ownerId,ttlMs:10000}),signal:AbortSignal.timeout(4000)
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
  return `(async()=>{const text=${JSON.stringify(text)},expected=text.trim();const sleep=ms=>new Promise(r=>setTimeout(r,ms));const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const securityBlock=()=>{if(document.querySelector('iframe[src*=\"captcha\" i],iframe[src*=\"challenge\" i],[class*=\"captcha\" i],[id*=\"captcha\" i]'))return'BLOCKED_CAPTCHA';const t=[...document.querySelectorAll('[role=\"alert\"],[role=\"dialog\"],[data-testid*=\"toast\" i]')].slice(0,30).map(e=>(e.textContent||'').toLowerCase()).join(' '),m=[['rate limit','BLOCKED_RATE_LIMIT'],['too many requests','BLOCKED_RATE_LIMIT'],['suspicious activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['unusual activity','BLOCKED_SUSPICIOUS_ACTIVITY'],['verify your identity','BLOCKED_REAUTH'],['verify it’s you','BLOCKED_REAUTH'],['xác minh danh tính','BLOCKED_REAUTH']];for(const [n,s] of m)if(t.includes(n))return s;return null;};const blocked=securityBlock();if(blocked)return{ok:false,status:blocked};if(!expected)return{ok:false,status:'EMPTY_WORK_ORDER'};const sels=location.hostname==='chatgpt.com'?['#prompt-textarea','div[contenteditable=\"true\"][data-lexical-editor=\"true\"]','[contenteditable=\"true\"][role=\"textbox\"]','textarea']:['rich-textarea .ql-editor[contenteditable=\"true\"]','.ql-editor[contenteditable=\"true\"]','[contenteditable=\"true\"][role=\"textbox\"]','textarea'];const findComposer=()=>{for(const s of sels){const x=[...document.querySelectorAll(s)].find(vis);if(x)return x;}return null;};const composerText=e=>e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement?String(e.value||'').trim():String(e?.innerText||e?.textContent||'').trim();let c=findComposer();if(!c)return{ok:false,status:'COMPOSER_NOT_FOUND'};if(composerText(c)!==expected){c.focus();if(c instanceof HTMLTextAreaElement||c instanceof HTMLInputElement){const proto=c instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(c,text);c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));}else{const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(c);sel?.removeAllRanges();sel?.addRange(range);if(!document.execCommand('insertText',false,text)){c.textContent=text;c.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));}}}const scoped=['button[data-testid=\"send-button\"]','button[type=\"submit\"]','button[aria-label*=\"Send\" i]','button[aria-label*=\"Gửi\" i]','button[aria-label*=\"submit\" i]'],global=['button[data-testid=\"send-button\"]','button[aria-label*=\"Send\" i]','button[aria-label*=\"Gửi\" i]','button[aria-label*=\"submit\" i]'];const usable=e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';const findSend=()=>{for(const root of [c.closest?.('form'),c.parentElement].filter(Boolean))for(const s of scoped){const a=[...root.querySelectorAll(s)].filter(usable);if(a.length===1)return a[0];}for(const s of global){const a=[...document.querySelectorAll(s)].filter(usable);if(a.length===1)return a[0];}return null;};let b=null,until=Date.now()+3000;while(Date.now()<until){await sleep(150);const gate=securityBlock();if(gate)return{ok:false,status:gate};b=findSend();if(b)break;}if(!b)return{ok:false,status:'SEND_BUTTON_NOT_FOUND'};b.click();const busy=()=>['button[data-testid=\"stop-button\"]','button[aria-label*=\"Stop\" i]','button[aria-label*=\"Dừng\" i]'].some(s=>[...document.querySelectorAll(s)].some(vis));until=Date.now()+3500;while(Date.now()<until){await sleep(100);const gate=securityBlock();if(gate)return{ok:false,status:gate};if(busy())return{ok:true,status:'SUBMITTED',evidence:'UI_BUSY'};if(location.hostname==='chatgpt.com'&&[...document.querySelectorAll('[data-message-author-role=\"user\"]')].some(e=>vis(e)&&String(e.textContent||'').trim()===expected))return{ok:true,status:'SUBMITTED',evidence:'USER_MESSAGE_VISIBLE'};c=findComposer();if(c&&composerText(c)==='')return{ok:true,status:'SUBMITTED',evidence:'COMPOSER_CLEARED'};}return{ok:false,status:'SUBMIT_EVIDENCE_MISSING'};})()`;
}
async function dispatch(target,text){
  const p=await pageRpc(target);
  try{return (await p.call('Runtime.evaluate',{expression:dispatchExpr(text),awaitPromise:true,returnByValue:true,userGesture:true},10000)).result.value;}
  finally{p.close();}
}
function archiveExpr(){return `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const candidates=[...document.querySelectorAll('button,[role="button"]')].filter(vis);let menu=candidates.find(e=>/conversation options|chat options|more|tùy chọn|thêm/i.test((e.getAttribute('aria-label')||e.textContent||'').trim()));if(menu){menu.click();await sleep(500);}const actions=[...document.querySelectorAll('[role="menuitem"],button,[role="button"]')].filter(vis);const archive=actions.find(e=>/^(archive|lưu trữ)$/i.test((e.textContent||e.getAttribute('aria-label')||'').trim()));if(!archive)return{ok:false,status:'ARCHIVE_ACTION_NOT_FOUND'};archive.click();await sleep(400);return{ok:true,status:'ARCHIVED'};})()`; }
async function archiveChat(target){const p=await pageRpc(target);try{return (await p.call('Runtime.evaluate',{expression:archiveExpr(),awaitPromise:true,returnByValue:true,userGesture:true},10000)).result.value;}finally{p.close();}}
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
    const ui=await uiState(target);const windowId=await windowIdFor(port,target.id);
    const display={workArea:{left:0,top:0,width:Number(config.layout?.fallbackWorkAreaWidth||3277),height:1688}};
    await post('/api/heartbeat',w.id,{workerId:w.id,state:ui.uiReady?'READY':'LOADING',windowId,tabId:target.id,url:ui.url,active:true,uiReady:ui.uiReady,authRequired:ui.authRequired===true,uiBusy:ui.uiBusy,securityBlock:ui.securityBlock,display});
    const command=await getCommand(w.id);if(!command)return;
    try{const result=await handleCommand(w,target,command);await post('/api/result',w.id,{workerId:w.id,commandId:command.id,ok:true,...result});}
    catch(error){await post('/api/result',w.id,{workerId:w.id,commandId:command.id,ok:false,status:String(error?.message||error)}).catch(()=>{});}
  }catch(error){
    const msg=String(error?.message||error);
    if(!/fetch failed|ECONNREFUSED|CDP_LIST|AbortError|TimeoutError/.test(msg)) log('WORKER_TICK_ERROR',{workerId:w.id,error:msg});
  }finally{busy.delete(w.id);}
}

async function tick(){await Promise.all(config.workers.filter(w=>w.enabled!==false).map(tickWorker));}
http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,workers:config.workers.map(w=>w.id)}));return;}res.writeHead(404);res.end();}).listen(8799,'127.0.0.1',()=>log('BRIDGE_READY',{port:8799}));
setInterval(()=>void tick(),3000).unref();
void tick();
