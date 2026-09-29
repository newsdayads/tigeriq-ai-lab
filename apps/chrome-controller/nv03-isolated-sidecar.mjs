import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const WORKER_ID='NV03';
const CDP_PORT=Number(process.env.TIGERIQ_NV03_CDP_PORT||9223);
const CONTROL_PORT=Number(process.env.TIGERIQ_NV03_CONTROL_PORT||8823);
const HOME_URL=String(process.env.TIGERIQ_NV03_HOME_URL||'https://chatgpt.com/g/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab/project#tigeriq-worker=NV03');
const CHROME_PATH=String(process.env.TIGERIQ_CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
const USER_DATA_DIR=String(process.env.TIGERIQ_NV03_USER_DATA||'D:\\TigerIQ\\Chrome\\NV03-Worker\\UserData');
const PROFILE_DIRECTORY=String(process.env.TIGERIQ_NV03_PROFILE||'Profile 3');
const RUNTIME_DIR=String(process.env.TIGERIQ_NV03_RUNTIME_DIR||'D:\\TigerIQ\\Apps\\NV03Sidecar\\Runtime');
const STATE_PATH=`${RUNTIME_DIR}\\state.json`;
const ASSIGNMENT_PATH=`${RUNTIME_DIR}\\assignment.json`;
const LOG_PATH=`${RUNTIME_DIR}\\events.jsonl`;
const POLL_MS=Math.max(5000,Number(process.env.TIGERIQ_NV03_POLL_MS||15000));
const CONTINUE_MIN_MS=Math.max(60000,Number(process.env.TIGERIQ_NV03_CONTINUE_MIN_MS||300000));
const CONTINUE_MAX_MS=Math.max(CONTINUE_MIN_MS,Number(process.env.TIGERIQ_NV03_CONTINUE_MAX_MS||600000));
const OWNER_SCOPE='APP_CHROME_NV03_ROLLOUT_20260929';
const CONTINUE_PROMPTS=Object.freeze([
  'Tiếp tục đúng việc review hiện tại',
  'Làm tiếp phần review đang dở',
  'Tiếp tục kiểm tra đúng Work Order hiện tại',
  'Tiếp tục review, không đổi việc',
  'Xử lý tiếp phần QA hiện tại',
]);

await mkdir(RUNTIME_DIR,{recursive:true});

function now(){return new Date().toISOString();}
function randomContinueAt(){return Date.now()+Math.floor(CONTINUE_MIN_MS+Math.random()*(CONTINUE_MAX_MS-CONTINUE_MIN_MS+1));}
function readJson(path,fallback){try{return JSON.parse(fs.readFileSync(path,'utf8'));}catch{return fallback;}}
function readState(){return readJson(STATE_PATH,{phase:'BOOT',lastUrl:'',authRequired:false,launchAttempts:0,nextContinueAt:0,dispatches:0});}
function readAssignment(){return readJson(ASSIGNMENT_PATH,null);}
async function saveState(state){await writeFile(STATE_PATH,JSON.stringify(state,null,2)+'\n','utf8');}
async function saveAssignment(value){
  if(value===null){try{fs.unlinkSync(ASSIGNMENT_PATH);}catch{};return;}
  await writeFile(ASSIGNMENT_PATH,JSON.stringify(value,null,2)+'\n','utf8');
}
async function log(event,data={}){
  const row={ts:now(),event,workerId:WORKER_ID,...data};
  fs.appendFileSync(LOG_PATH,JSON.stringify(row)+'\n','utf8');
}

async function fetchJson(url,init={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),3500);
  try{
    const response=await fetch(url,{...init,signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP_${response.status}`);
    return await response.json();
  }finally{clearTimeout(timer);}
}

async function listTargets(){
  const data=await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return Array.isArray(data)?data:Array.isArray(data?.value)?data.value:[];
}

function pickTarget(rows,preferredId='',preferredUrl=''){
  const pages=rows.filter((row)=>row?.type==='page'&&/^https:\/\/chatgpt\.com\//i.test(String(row?.url||'')));
  if(preferredId){const byId=pages.find((row)=>String(row.id||'')===String(preferredId));if(byId)return byId;}
  if(preferredUrl){const byUrl=pages.find((row)=>String(row.url||'')===String(preferredUrl));if(byUrl)return byUrl;}
  return pages.find((row)=>/\/c\//i.test(String(row.url||'')))||pages.find((row)=>/tigeriq-worker=NV03/i.test(String(row.url||'')))||pages[0]||null;
}

function launchChrome(){
  const child=spawn(CHROME_PATH,[
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    `--profile-directory=${PROFILE_DIRECTORY}`,
    '--new-window',
    HOME_URL,
  ],{detached:true,stdio:'ignore',windowsHide:false});
  child.unref();
  return child.pid||null;
}

class Rpc{
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
      let message;try{message=JSON.parse(String(event.data));}catch{return;}
      if(!message.id)return;
      const pending=this.pending.get(message.id);if(!pending)return;
      this.pending.delete(message.id);clearTimeout(pending.timer);
      if(message.error)pending.reject(new Error(message.error.message||'CDP_RPC_ERROR'));else pending.resolve(message.result);
    });
  }
  async call(method,params={},timeout=6000){
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

const UI_EXPR=`(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const composer=[...document.querySelectorAll('#prompt-textarea,[contenteditable="true"][role="textbox"],textarea')].find(vis);const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(vis);const stopVisible=buttons.some(e=>/stop|dừng|ngừng/i.test((e.getAttribute('aria-label')||e.textContent||'').trim()));const assistants=[...document.querySelectorAll('[data-message-author-role="assistant"]')].filter(vis);const lastAssistant=assistants.at(-1);const assistantText=(lastAssistant?.innerText||lastAssistant?.textContent||'').slice(-10000);const text=(document.body?.innerText||'').slice(-10000);const terminal=(assistantText.match(/NV03_TERMINAL\\s*=\\s*(PASS|CHANGES_REQUIRED|BLOCKED)/i)||[])[1]||'';return{url:location.href,title:document.title,composerReady:!!composer,stopVisible,authRequired:/^\\/auth\\/login/i.test(location.pathname),terminal,assistantText,text}})()`;

async function uiState(target){
  const rpc=new Rpc(target.webSocketDebuggerUrl);
  try{
    const result=await rpc.call('Runtime.evaluate',{expression:UI_EXPR,returnByValue:true},6000);
    return result?.result?.value||{};
  }finally{rpc.close();}
}

function submitExpr(text){
  const encoded=JSON.stringify(String(text));
  return `(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const c=[...document.querySelectorAll('#prompt-textarea,[contenteditable="true"][role="textbox"],textarea')].find(vis);if(!c)return{ok:false,status:'COMPOSER_NOT_FOUND'};c.focus();const t=${encoded};if(c.tagName==='TEXTAREA'||c.tagName==='INPUT'){c.value=t;c.dispatchEvent(new Event('input',{bubbles:true}));}else{c.innerHTML='';c.textContent=t;c.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}const send=[...document.querySelectorAll('button,[role="button"]')].filter(vis).find(e=>/send|gửi/i.test((e.getAttribute('aria-label')||e.textContent||'').trim())&&!e.disabled);if(send){send.click();return{ok:true,status:'SEND_CLICKED'}};c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));c.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));return{ok:true,status:'ENTER_DISPATCHED'}})()`;
}

async function submit(target,text){
  const rpc=new Rpc(target.webSocketDebuggerUrl);
  try{
    const result=await rpc.call('Runtime.evaluate',{expression:submitExpr(text),returnByValue:true,userGesture:true},8000);
    return result?.result?.value||{ok:false,status:'NO_RESULT'};
  }finally{rpc.close();}
}

async function navigate(target,url){
  const rpc=new Rpc(target.webSocketDebuggerUrl);
  try{await rpc.call('Page.navigate',{url},6000);}finally{rpc.close();}
}

function assignmentPrompt(a){
  return [
    'LÀM — NO YAPPING.',
    'WORKER=NV03',
    'ROLE=INDEPENDENT_REVIEW_QA',
    `CURRENT_WORK_ORDER=${a.workOrder}`,
    `SOURCE_ISSUE=${a.issueUrl}`,
    `CLAIM_ID=${a.claimId}`,
    `RESOURCE_SCOPE=${a.resourceScope}`,
    `INPUT_REVISION=${a.inputRevision}`,
    'MUTATION_ALLOWED=false',
    'YÊU_CẦU=Đọc GitHub trực tiếp, review/QA độc lập đúng Work Order đã bind. Không tự chọn backlog khác. Không sửa code, không merge, không deploy, không mutation runtime.',
    `KẾT_QUẢ=Ghi COMMENT trực tiếp về GitHub issue nguồn, bắt buộc có CLAIM_ID=${a.claimId}, REVIEW=PASS|CHANGES_REQUIRED hoặc STATE=BLOCKED|EXTERNAL_WAIT, exact head/input revision, findings và evidence. Không dùng GitHub PR Approve/Review action trừ khi Work Order yêu cầu rõ; không coi việc cùng GitHub account là blocker cho worker-review evidence. Không tự đóng issue; router sẽ reconcile/release claim.`,
    'KHI_KẾT_THÚC=Trong chat trả đúng một dòng cuối NV03_TERMINAL=PASS hoặc NV03_TERMINAL=CHANGES_REQUIRED hoặc NV03_TERMINAL=BLOCKED.',
    String(a.prompt||''),
  ].join('\n');
}

async function ensureTarget(){
  let rows;
  try{rows=await listTargets();}
  catch(error){
    const state=readState();
    const launchedAt=Number(state.lastLaunchAt||0);
    if(Date.now()-launchedAt>30000){
      const pid=launchChrome();
      await saveState({...state,phase:'LAUNCHING',lastLaunchAt:Date.now(),lastLaunchPid:pid,launchAttempts:Number(state.launchAttempts||0)+1,lastError:''});
      await log('NV03_CHROME_LAUNCHED',{pid,debugPort:CDP_PORT});
    }
    throw error;
  }
  const currentAssignment=readAssignment();
  const currentState=readState();
  let target=pickTarget(rows,currentAssignment?.targetId||'',currentAssignment?String(currentState.lastUrl||''):'');
  if(!target)return null;
  let ui=await uiState(target);
  if(currentAssignment?.freshContext&&!currentAssignment?.dispatchedAt&&!ui.authRequired){
    await navigate(target,HOME_URL);
    await new Promise((resolve)=>setTimeout(resolve,1500));
    const refreshed=await listTargets();
    target=refreshed.find((row)=>String(row.id||'')===String(target.id||''))||pickTarget(refreshed)||target;
    ui=await uiState(target);
  }else if(!ui.authRequired&&!/\/g\/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab\/(?:project|c\/)/i.test(String(ui.url||''))){
    await navigate(target,HOME_URL);
    await new Promise((resolve)=>setTimeout(resolve,1500));
    const refreshed=await listTargets();
    target=pickTarget(refreshed,currentAssignment?.targetId||'',currentAssignment?String(currentState.lastUrl||''):'')||target;
    ui=await uiState(target);
  }
  return {target,ui};
}

let cycleBusy=false;
async function cycle(){
  if(cycleBusy)return;
  cycleBusy=true;
  try{
    let state=readState();
    const pair=await ensureTarget();
    if(!pair){
      state={...state,phase:'NO_CHATGPT_TARGET',lastUrl:'',authRequired:false};
      await saveState(state);return;
    }
    const {target,ui}=pair;
    state.lastUrl=String(ui.url||'');
    if(ui.authRequired){
      if(!state.authRequired)await log('AUTH_REQUIRED',{url:ui.url});
      state={...state,phase:'BLOCKED_AUTH_REQUIRED',authRequired:true,nextContinueAt:0};
      await saveState(state);return;
    }
    state.authRequired=false;
    const assignment=readAssignment();
    if(!assignment){
      state={...state,phase:'READY_UNASSIGNED',activeJobId:'',nextContinueAt:0};
      await saveState(state);return;
    }
    state.activeJobId=assignment.jobId;
    if(ui.terminal){
      state={...state,phase:'TERMINAL',terminal:String(ui.terminal).toUpperCase(),nextContinueAt:0};
      await saveState(state);
      if(!assignment.terminalObservedAt){
        await saveAssignment({...assignment,terminal:String(ui.terminal).toUpperCase(),terminalObservedAt:now()});
        await log('NV03_TERMINAL_OBSERVED',{jobId:assignment.jobId,terminal:String(ui.terminal).toUpperCase()});
      }
      return;
    }
    if(ui.stopVisible){
      state={...state,phase:'WORKING'};
      await saveState(state);return;
    }
    if(!ui.composerReady){
      state={...state,phase:'STALLED'};
      await saveState(state);return;
    }
    if(!assignment.dispatchedAt){
      const sent=await submit(target,assignmentPrompt(assignment));
      if(sent?.ok){
        const updated={...assignment,dispatchedAt:now(),dispatchStatus:sent.status,targetId:String(target.id||''),freshContext:false};
        await saveAssignment(updated);
        state={...state,phase:'DISPATCHED',dispatches:Number(state.dispatches||0)+1,nextContinueAt:randomContinueAt()};
        await saveState(state);
        await log('NV03_ASSIGNMENT_DISPATCHED',{jobId:assignment.jobId,status:sent.status,issueUrl:assignment.issueUrl});
      }else{
        state={...state,phase:'READY',lastError:String(sent?.status||'DISPATCH_FAILED')};
        await saveState(state);
      }
      return;
    }
    if(Date.now()>=Number(state.nextContinueAt||0)){
      const prompt=CONTINUE_PROMPTS[Math.floor(Math.random()*CONTINUE_PROMPTS.length)];
      const sent=await submit(target,prompt);
      state={...state,phase:sent?.ok?'CONTINUE_DISPATCHED':'READY',dispatches:Number(state.dispatches||0)+(sent?.ok?1:0),nextContinueAt:randomContinueAt(),lastContinuePrompt:sent?.ok?prompt:state.lastContinuePrompt||''};
      await saveState(state);
      await log(sent?.ok?'NV03_CONTINUE_DISPATCHED':'NV03_CONTINUE_FAILED',{jobId:assignment.jobId,status:sent?.status||null,prompt:sent?.ok?prompt:null});
      return;
    }
    state={...state,phase:'READY'};
    await saveState(state);
  }catch(error){
    const state=readState();
    await saveState({...state,phase:'RECOVERING',lastError:String(error?.message||error),lastErrorAt:now()}).catch(()=>{});
    await log('CYCLE_ERROR',{error:String(error?.message||error)}).catch(()=>{});
  }finally{cycleBusy=false;}
}

function sendJson(res,status,payload){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(payload));
}

const server=http.createServer((req,res)=>{
  if(req.method==='GET'&&req.url==='/health'){
    const state=readState();
    const assignment=readAssignment();
    sendJson(res,200,{ok:true,workerId:WORKER_ID,ownerScope:OWNER_SCOPE,debugPort:CDP_PORT,controlPort:CONTROL_PORT,state,assignment:assignment?{jobId:assignment.jobId,claimId:assignment.claimId,targetId:assignment.targetId||null,freshContext:Boolean(assignment.freshContext),workOrder:assignment.workOrder,issueUrl:assignment.issueUrl,inputRevision:assignment.inputRevision,dispatchedAt:assignment.dispatchedAt||null,terminal:assignment.terminal||null}:null});
    return;
  }
  if(req.method==='POST'&&(req.url==='/assign'||req.url==='/release')){
    let body='';
    req.on('data',(chunk)=>{body+=chunk;if(body.length>65536)req.destroy();});
    req.on('end',async()=>{
      try{
        const data=JSON.parse(body||'{}');
        if(req.url==='/assign'){
          for(const key of ['jobId','claimId','workOrder','issueUrl','resourceScope','inputRevision']){
            if(!String(data[key]||'').trim())throw new Error(`ASSIGN_${key.toUpperCase()}_REQUIRED`);
          }
          const current=readAssignment();
          if(current&&current.jobId!==data.jobId&&!current.terminal)throw new Error('NV03_ACTIVE_ASSIGNMENT_CONFLICT');
          const sameJob=Boolean(current&&current.jobId===String(data.jobId));
          const assignment={jobId:String(data.jobId),claimId:String(data.claimId),workOrder:String(data.workOrder),issueUrl:String(data.issueUrl),resourceScope:String(data.resourceScope),inputRevision:String(data.inputRevision),prompt:String(data.prompt||''),assignedAt:now(),dispatchedAt:null,terminal:null,targetId:sameJob?String(current.targetId||''):'',freshContext:!sameJob};
          await saveAssignment(assignment);
          const state=readState();
          await saveState({...state,phase:'ASSIGNED',activeJobId:assignment.jobId,nextContinueAt:0,terminal:''});
          await log('NV03_ASSIGNMENT_ACCEPTED',{jobId:assignment.jobId,issueUrl:assignment.issueUrl,resourceScope:assignment.resourceScope});
          sendJson(res,200,{ok:true,status:'ASSIGNED',jobId:assignment.jobId});
          void cycle();
          return;
        }
        const current=readAssignment();
        if(!current){sendJson(res,200,{ok:true,status:'ALREADY_UNASSIGNED'});return;}
        if(String(data.jobId||'')!==String(current.jobId))throw new Error('NV03_RELEASE_JOB_MISMATCH');
        await saveAssignment(null);
        const state=readState();
        await saveState({...state,phase:'READY_UNASSIGNED',activeJobId:'',nextContinueAt:0,terminal:''});
        await log('NV03_ASSIGNMENT_RELEASED',{jobId:current.jobId});
        sendJson(res,200,{ok:true,status:'RELEASED',jobId:current.jobId});
      }catch(error){sendJson(res,409,{ok:false,error:String(error?.message||error)});}
    });
    return;
  }
  sendJson(res,404,{ok:false,error:'NOT_FOUND'});
});

server.listen(CONTROL_PORT,'127.0.0.1',async()=>{
  await log('NV03_SIDECAR_STARTED',{pid:process.pid,debugPort:CDP_PORT,controlPort:CONTROL_PORT,ownerScope:OWNER_SCOPE});
  void cycle();
});
setInterval(()=>void cycle(),POLL_MS).unref();
