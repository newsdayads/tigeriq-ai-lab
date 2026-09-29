import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const WORKER_ID='NV03';
const CDP_PORT=Number(process.env.TIGERIQ_NV03_CDP_PORT||9223);
const HOME_URL=String(process.env.TIGERIQ_NV03_HOME_URL||'https://chatgpt.com/g/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab/project#tigeriq-worker=NV03');
const RUNTIME_DIR=String(process.env.TIGERIQ_NV03_RUNTIME_DIR||'D:\\TigerIQ\\Apps\\NV03Sidecar\\Runtime');
const STATE_PATH=`${RUNTIME_DIR}\\state.json`;
const LOG_PATH=`${RUNTIME_DIR}\\events.jsonl`;
const POLL_MS=Math.max(5000,Number(process.env.TIGERIQ_NV03_POLL_MS||15000));
const WAKE_MIN_MS=Math.max(60000,Number(process.env.TIGERIQ_NV03_WAKE_MIN_MS||300000));
const WAKE_MAX_MS=Math.max(WAKE_MIN_MS,Number(process.env.TIGERIQ_NV03_WAKE_MAX_MS||600000));
const OWNER_SCOPE='APP_CHROME_NV03_ROLLOUT_20260929';

const SELF_PULL_PROMPT=[
  'LÀM — NO YAPPING.',
  'WORKER=NV03',
  'ROLE=INDEPENDENT_REVIEW_QA',
  'SOURCE=GitHub canonical của TigerIQ AI Lab.',
  'NHIỆM_VỤ=Kiểm tra GitHub trực tiếp. Nếu đang có review/QA đã claim hợp lệ thì tiếp tục đúng việc đó đến PASS hoặc CHANGES_REQUIRED hoặc BLOCKED và ghi evidence về đúng Issue/PR. Nếu không có việc đang claim thì chỉ chọn đúng 1 Work Order/PR P1-P5 thuộc REVIEW/QA phù hợp vai trò NV03, không code, không merge, không deploy, không mutation runtime. P0 chỉ làm khi có OWNER_DIRECT rõ ràng trên chính Work Order.',
  'CLAIM=Trước khi làm phải claim đúng resource scope theo cơ chế GitHub canonical; không đụng scope đang có owner khác.',
  'OUTPUT=Kết quả phải ghi trực tiếp về GitHub với exact head/input revision, findings và evidence. Không tự sửa lỗi được phát hiện.',
  `OWNER_SCOPE=${OWNER_SCOPE}`,
].join('\n');

await mkdir(RUNTIME_DIR,{recursive:true});

function now(){return new Date().toISOString();}
function randomWake(){return Date.now()+Math.floor(WAKE_MIN_MS+Math.random()*(WAKE_MAX_MS-WAKE_MIN_MS+1));}
function readState(){
  try{return JSON.parse(fs.readFileSync(STATE_PATH,'utf8'));}catch{return {nextWakeAt:0,lastPhase:'BOOT',lastUrl:'',dispatches:0,authRequired:false};}
}
async function saveState(state){await writeFile(STATE_PATH,JSON.stringify(state,null,2)+'\n','utf8');}
async function log(event,data={}){
  const row={ts:now(),event,workerId:WORKER_ID,...data};
  fs.appendFileSync(LOG_PATH,JSON.stringify(row)+'\n','utf8');
}

async function listTargets(){
  const response=await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`,{signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error(`CDP_LIST_HTTP_${response.status}`);
  const data=await response.json();
  return Array.isArray(data)?data:Array.isArray(data?.value)?data.value:[];
}

function pickTarget(rows){
  const pages=rows.filter((r)=>r?.type==='page'&&/^https:\/\/chatgpt\.com\//i.test(String(r?.url||'')));
  if(!pages.length)return null;
  return pages.find((r)=>/tigeriq-worker=NV03/i.test(String(r.url||'')))||pages[0];
}

class Rpc {
  constructor(url){
    this.ws=new WebSocket(url);
    this.id=0;
    this.pending=new Map();
    this.ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('CDP_OPEN_TIMEOUT')),4000);
      this.ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      this.ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('CDP_OPEN_ERROR'));},{once:true});
    });
    this.ws.addEventListener('message',(event)=>{
      let msg;try{msg=JSON.parse(String(event.data));}catch{return}
      if(!msg.id)return;
      const item=this.pending.get(msg.id);if(!item)return;
      this.pending.delete(msg.id);clearTimeout(item.timer);
      if(msg.error)item.reject(new Error(msg.error.message||'CDP_RPC_ERROR'));else item.resolve(msg.result);
    });
  }
  async call(method,params={},timeout=5000){
    await this.ready;
    const id=++this.id;
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP_TIMEOUT:${method}`));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      this.ws.send(JSON.stringify({id,method,params}));
    });
  }
  close(){try{this.ws.close();}catch{}}
}

const UI_EXPR=`(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const composer=[...document.querySelectorAll('#prompt-textarea,[contenteditable="true"][role="textbox"],textarea')].find(vis);const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(vis);const stopVisible=buttons.some(e=>/stop|dừng|ngừng/i.test((e.getAttribute('aria-label')||e.textContent||'').trim()));const sendVisible=buttons.some(e=>/send|gửi/i.test((e.getAttribute('aria-label')||e.textContent||'').trim()));return{url:location.href,pathname:location.pathname,title:document.title,composerReady:!!composer,stopVisible,sendVisible,authRequired:/^\\/auth\\/login/i.test(location.pathname),text:(document.body?.innerText||'').slice(-6000)}})()`;

async function uiState(target){
  const rpc=new Rpc(target.webSocketDebuggerUrl);
  try{
    const result=await rpc.call('Runtime.evaluate',{expression:UI_EXPR,returnByValue:true},5000);
    return result?.result?.value||{};
  }finally{rpc.close();}
}

function escapeJs(value){return JSON.stringify(String(value));}
function submitExpr(text){
  return `(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const c=[...document.querySelectorAll('#prompt-textarea,[contenteditable="true"][role="textbox"],textarea')].find(vis);if(!c)return{ok:false,status:'COMPOSER_NOT_FOUND'};c.focus();const t=${escapeJs(text)};if(c.tagName==='TEXTAREA'||c.tagName==='INPUT'){c.value=t;c.dispatchEvent(new Event('input',{bubbles:true}));}else{c.innerHTML='';c.textContent=t;c.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(vis);const send=buttons.find(e=>/send|gửi/i.test((e.getAttribute('aria-label')||e.textContent||'').trim())&&!e.disabled);if(send){send.click();return{ok:true,status:'SEND_CLICKED'}}c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));c.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));return{ok:true,status:'ENTER_DISPATCHED'}})()`;
}

async function submit(target,text){
  const rpc=new Rpc(target.webSocketDebuggerUrl);
  try{
    const result=await rpc.call('Runtime.evaluate',{expression:submitExpr(text),awaitPromise:true,returnByValue:true,userGesture:true},8000);
    return result?.result?.value||{ok:false,status:'NO_RESULT'};
  }finally{rpc.close();}
}

async function ensureProjectTarget(target,ui){
  if(ui.authRequired)return {target,ui};
  if(/\/g\/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab\/(?:project|c\/)/i.test(String(ui.url||'')))return{target,ui};
  const rpc=new Rpc(target.webSocketDebuggerUrl);
  try{await rpc.call('Page.navigate',{url:HOME_URL},5000);}finally{rpc.close();}
  await new Promise(r=>setTimeout(r,1500));
  const rows=await listTargets();
  const current=pickTarget(rows)||target;
  return {target:current,ui:await uiState(current)};
}

async function cycle(){
  let state=readState();
  try{
    const rows=await listTargets();
    let target=pickTarget(rows);
    if(!target){
      state={...state,lastPhase:'NO_CHATGPT_TARGET',lastUrl:'',authRequired:false};
      await saveState(state);await log('NO_CHATGPT_TARGET',{port:CDP_PORT});return;
    }
    let ui=await uiState(target);
    ({target,ui}=await ensureProjectTarget(target,ui));
    state.lastUrl=String(ui.url||'');
    if(ui.authRequired){
      if(!state.authRequired)await log('AUTH_REQUIRED',{url:ui.url});
      state={...state,lastPhase:'AUTH_REQUIRED',authRequired:true,nextWakeAt:0};
      await saveState(state);return;
    }
    state.authRequired=false;
    if(ui.stopVisible){
      state={...state,lastPhase:'WORKING'};
      await saveState(state);return;
    }
    if(!ui.composerReady){
      state={...state,lastPhase:'STALLED'};
      await saveState(state);return;
    }
    const nowMs=Date.now();
    if(!Number(state.nextWakeAt)||nowMs>=Number(state.nextWakeAt)){
      const sent=await submit(target,SELF_PULL_PROMPT);
      state={...state,lastPhase:sent?.ok?'DISPATCHED':'READY',nextWakeAt:randomWake(),dispatches:Number(state.dispatches||0)+(sent?.ok?1:0),lastDispatchAt:sent?.ok?now():state.lastDispatchAt||null,lastDispatchStatus:sent?.status||null};
      await saveState(state);
      await log(sent?.ok?'NV03_WAKE_DISPATCHED':'NV03_WAKE_FAILED',{status:sent?.status||null,url:ui.url,nextWakeAt:state.nextWakeAt});
      return;
    }
    state={...state,lastPhase:'READY'};
    await saveState(state);
  }catch(error){
    state={...state,lastPhase:'ERROR',lastError:String(error?.message||error),lastErrorAt:now()};
    await saveState(state).catch(()=>{});
    await log('CYCLE_ERROR',{error:String(error?.message||error)}).catch(()=>{});
  }
}

await log('NV03_SIDECAR_STARTED',{pid:process.pid,port:CDP_PORT,ownerScope:OWNER_SCOPE});
setInterval(()=>void cycle(),POLL_MS).unref();
await cycle();
await new Promise(()=>{});
