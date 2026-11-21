// Trusted Core → authenticated Windows interactive owner session adapter.
// This adapter does not create a scheduler/queue. Existing Core job and lease own the work.
// SYSTEM must never read or impersonate a user's CLI credential profile.
import {promises as fs} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const execFileAsync=promisify(execFile);
export const OWNER_CLI_BRIDGE_ROOT='C:\\ProgramData\\TigerIQOwnerAiBridge';
export const OWNER_CLI_BRIDGE_TASK='TigerIQ Owner AI Session';
const INPUT='request.json',OUTPUT='response.json',LOCK='active.lock';
const SCHEMA='TIGERIQ_OWNER_CLI_BRIDGE_V1';
const MAX_PROMPT=12000;
const MAX_WAIT_MS=210000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL=/^[a-z0-9][a-z0-9._-]{1,99}$/i;

export function ownerCliNeedsUserSession(env=process.env){
  return String(env.USERNAME||'').toUpperCase()==='SYSTEM'
    || /\\windows\\system32\\config\\systemprofile(?:\\|$)/i.test(String(env.LOCALAPPDATA||''));
}
export function validateOwnerCliBridgeRequest(req,{nowMs=Date.now()}={}){
  if(!req||req.schema!==SCHEMA||!UUID.test(String(req.requestId||'')))
    throw new Error('OWNER_CLI_BRIDGE_REQUEST_INVALID');
  const timestamp=Date.parse(String(req.createdAt||''));
  if(!Number.isFinite(timestamp)||Math.abs(nowMs-timestamp)>90000)
    throw new Error('OWNER_CLI_BRIDGE_REQUEST_STALE');
  if(req.action==='quota')return {requestId:req.requestId,action:'quota'};
  if(req.action!=='execute'||!['antigravity','codex'].includes(req.provider)
    || !MODEL.test(String(req.model||''))||typeof req.prompt!=='string'
    || !req.prompt.trim()||req.prompt.length>MAX_PROMPT)
    throw new Error('OWNER_CLI_BRIDGE_SCOPE_DENIED');
  const timeout=Number(req.timeoutMs);
  if(!Number.isFinite(timeout)||timeout<5000||timeout>180000)
    throw new Error('OWNER_CLI_BRIDGE_TIMEOUT_INVALID');
  return {requestId:req.requestId,action:'execute',provider:req.provider,
    model:req.model,prompt:req.prompt,timeoutMs:Math.floor(timeout)};
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failed=msg=>Object.assign(new Error(msg),{kind:'configuration'});

async function assertBridgeRoot(root){
  if(process.platform!=='win32')throw failed('OWNER_CLI_WINDOWS_REQUIRED');
  if(root!==OWNER_CLI_BRIDGE_ROOT)throw failed('OWNER_CLI_BRIDGE_ROOT_UNTRUSTED');
  const stat=await fs.lstat(root);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw failed('OWNER_CLI_BRIDGE_ROOT_UNTRUSTED');
}

// One slot at a time because Windows Task Scheduler ignores duplicate running task
// invocations. The Core job lease is distinct and remains the authority for routing.
// On uncertain timeout leave active.lock for explicit receipt reconciliation.
export async function runOwnerCliInUserSession({action,provider,model,prompt,timeoutMs=60000,
  root=OWNER_CLI_BRIDGE_ROOT,taskName=OWNER_CLI_BRIDGE_TASK,startTask,
  now=()=>Date.now(),sleep=delay}={}){
  await assertBridgeRoot(root);
  const requestId=randomUUID();
  const request={schema:SCHEMA,requestId,createdAt:new Date(now()).toISOString(),action,
    ...(action==='execute'?{provider,model,prompt,timeoutMs}:{}),
  };
  validateOwnerCliBridgeRequest(request,{nowMs:now()});
  const lockPath=join(root,LOCK),inputPath=join(root,INPUT),outputPath=join(root,OUTPUT);
  let lock;
  try{lock=await fs.open(lockPath,'wx',0o600);}
  catch(error){
    if(error?.code==='EEXIST')throw failed('OWNER_CLI_BRIDGE_BUSY');
    throw error;
  }
  let taskStarted=false,completed=false;
  try{
    await lock.writeFile(JSON.stringify({requestId,createdAt:request.createdAt}));
    // Never overwrite or delete a previous unknown response.
    try{await fs.access(outputPath);throw failed('OWNER_CLI_BRIDGE_PENDING_RECEIPT');}
    catch(error){if(error?.code!=='ENOENT')throw error;}
    await fs.writeFile(inputPath,JSON.stringify(request),{flag:'wx',mode:0o600});
    if(startTask)await startTask(taskName);
    else await execFileAsync('schtasks.exe',['/Run','/TN',taskName],{timeout:12000,windowsHide:true});
    taskStarted=true;
    const deadline=now()+Math.min(MAX_WAIT_MS,Number(timeoutMs)+30000);
    while(now()<deadline){
      try{
        const st=await fs.lstat(outputPath);
        if(!st.isFile()||st.isSymbolicLink()||st.size>524288)
          throw failed('OWNER_CLI_BRIDGE_RESULT_UNTRUSTED');
        const raw=await fs.readFile(outputPath,'utf8');
        const result=JSON.parse(raw.replace(/^\uFEFF/,''));
        if(result.schema!==SCHEMA||result.requestId!==requestId)
          throw failed('OWNER_CLI_BRIDGE_RESULT_MISMATCH');
        completed=true;
        if(result.ok!==true)throw failed(String(result.error||'OWNER_CLI_USER_WORKER_FAILED'));
        return result.value;
      }catch(error){if(error?.code!=='ENOENT')throw error;}
      await sleep(250);
    }
    throw failed('OWNER_CLI_BRIDGE_TIMEOUT_PENDING');
  }finally{
    await lock.close().catch(()=>{});
    if(completed||!taskStarted){
      await fs.unlink(inputPath).catch(()=>{});
      await fs.unlink(outputPath).catch(()=>{});
      await fs.unlink(lockPath).catch(()=>{});
    }
  }
}
