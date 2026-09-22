import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const OPENCLAW_EMPLOYEE_ID='NV06';
export const OPENCLAW_PROVIDER='openclaw';
export const OPENCLAW_MODEL='operator-local';
export const OPENCLAW_RESOURCE_ID='res:openclaw:operator-local:default:pc01';
export const DEFAULT_DISPATCH_ROOT=process.env.TIGERIQ_OPENCLAW_DISPATCH_ROOT||'D:\\TigerIQ-OpenClaw\\state\\tigeriq-dispatch';
export const DEFAULT_OPENCLAW_ENTRYPOINT=process.env.TIGERIQ_OPENCLAW_ENTRYPOINT||'D:\\OpenClaw\\npm-global\\node_modules\\openclaw\\openclaw.mjs';
export const DEFAULT_OPENCLAW_CONFIG=process.env.TIGERIQ_OPENCLAW_CONFIG_PATH||'D:\\TigerIQ-OpenClaw\\state\\openclaw.json';
export const DEFAULT_OPENCLAW_STATE_DIR=process.env.TIGERIQ_OPENCLAW_STATE_DIR||'D:\\TigerIQ-OpenClaw\\state';
const WORKER_PATH=fileURLToPath(new URL('./dispatch-worker.mjs',import.meta.url));
const TERMINAL=new Set(['completed','failed','rejected']);
const SAFE_KEY=/^[A-Za-z0-9._:-]{8,160}$/;
const SAFE_SCOPE=/^[A-Za-z0-9._:/#-]{3,240}$/;
const HARD_GATE_TEXT=/\b(?:production\s+(?:deploy|release|publish)|direct\s+(?:main|master)|credential\s+(?:change|rotate|write)|password\s+(?:change|reset)|security[- ]boundary|paid\s+(?:service|action|purchase)|purchase\b|delete\s+(?:repository|database|volume)|format\s+(?:disk|drive)|rm\s+-rf|reboot|shutdown)\b/i;

function sha(value){return createHash('sha256').update(String(value)).digest('hex');}
function clip(value,max){const s=String(value??'');return s.length<=max?s:s.slice(0,max);}
function dispatchFile(root,key){return path.join(root,sha(key)+'.json');}
function launchFile(recordPath){return recordPath+'.launch';}

export function deriveOpenClawCoreIds(idempotencyKey){
  const key=String(idempotencyKey||'').trim();
  if(!SAFE_KEY.test(key))throw new Error('OPENCLAW_IDEMPOTENCY_KEY_INVALID');
  const short=sha(key).slice(0,24);
  return {objectiveId:`OBJ-OC-${short}`,jobId:`JOB-OC-${short}`};
}

export function deriveOpenClawSessionKey(idempotencyKey){
  const short=sha(idempotencyKey).slice(0,32);
  return `agent:operator-local:tigeriq-${short}`;
}

export function normalizeOpenClawAuthority(raw={}){
  const out={
    production:Boolean(raw.production),
    paid:Boolean(raw.paid),
    credentialSecurity:Boolean(raw.credentialSecurity),
    destructiveIrreversible:Boolean(raw.destructiveIrreversible),
    sourceMutation:Boolean(raw.sourceMutation),
    arbitraryShell:Boolean(raw.arbitraryShell),
  };
  if(Object.values(out).some(Boolean))throw new Error('OPENCLAW_HARD_GATE_REFUSED');
  return out;
}

export function normalizeOpenClawDispatchEnvelope(raw={}){
  const jobId=String(raw.jobId||'').trim();
  const workOrderId=String(raw.workOrderId||'').trim();
  const resourceScope=String(raw.resourceScope||'').trim();
  const idempotencyKey=String(raw.idempotencyKey||'').trim();
  const instruction=String(raw.instruction||'').trim();
  const acceptance=String(raw.acceptance||'').trim();
  if(!SAFE_KEY.test(jobId)||!SAFE_KEY.test(workOrderId)||!SAFE_KEY.test(idempotencyKey))throw new Error('OPENCLAW_DISPATCH_ID_INVALID');
  if(!SAFE_SCOPE.test(resourceScope))throw new Error('OPENCLAW_RESOURCE_SCOPE_INVALID');
  if(instruction.length<8||instruction.length>6000)throw new Error('OPENCLAW_INSTRUCTION_INVALID');
  if(acceptance.length<4||acceptance.length>2000)throw new Error('OPENCLAW_ACCEPTANCE_INVALID');
  if(HARD_GATE_TEXT.test(instruction)||HARD_GATE_TEXT.test(acceptance))throw new Error('OPENCLAW_HARD_GATE_TEXT_REFUSED');
  const authority=normalizeOpenClawAuthority(raw.authority);
  const normalized={
    schema:'TIGERIQ_OPENCLAW_DISPATCH_V1',
    jobId,workOrderId,resourceScope,idempotencyKey,instruction,acceptance,authority,
    evidenceDestination:'core_job_result+durable_dispatch_state',
    agentId:'operator-local',
    sessionKey:deriveOpenClawSessionKey(idempotencyKey),
  };
  return {...normalized,envelopeHash:sha(JSON.stringify(normalized))};
}

export function buildOpenClawPrompt(envelope){
  const e=normalizeOpenClawDispatchEnvelope(envelope);
  return [
    'TIGERIQ_CORE_ASSIGNED_WORK_V1',
    `JOB_ID=${e.jobId}`,
    `WORK_ORDER_ID=${e.workOrderId}`,
    `RESOURCE_SCOPE=${e.resourceScope}`,
    `IDEMPOTENCY_KEY=${e.idempotencyKey}`,
    'AUTHORITY=SAFE_REVERSIBLE_ZERO_COST_RUNTIME_ONLY',
    'FORBIDDEN=backlog selection; P0 selection; new task selection; repository/source mutation; arbitrary shell; credentials/security; paid action; Production; destructive/irreversible action',
    `INSTRUCTION=${e.instruction}`,
    `ACCEPTANCE=${e.acceptance}`,
    'Execute ONLY this assigned work through the bounded TigerIQ tools. Do not inspect or choose other work.',
    'On retry/recovery, inspect current state first. If acceptance already holds, do not repeat the mutation; return evidence of the already-satisfied state.',
    'Return a concise final JSON object with status, evidence, and blocker. Never claim success without tool evidence.',
  ].join('\n');
}

export async function readOpenClawDispatchRecord(recordPath){
  try{return JSON.parse(await fs.readFile(recordPath,'utf8'));}catch(error){if(error?.code==='ENOENT')return null;throw error;}
}

async function atomicWrite(recordPath,value){
  const tmp=recordPath+`.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp,JSON.stringify(value,null,2),'utf8');
  await fs.rename(tmp,recordPath);
}

export async function writeOpenClawDispatchRecord(recordPath,value){
  await fs.mkdir(path.dirname(recordPath),{recursive:true});
  await atomicWrite(recordPath,value);
  return value;
}

function defaultProcessAlive(pid){
  if(!Number.isInteger(Number(pid))||Number(pid)<=0)return false;
  try{process.kill(Number(pid),0);return true;}catch{return false;}
}

function childEnv(){
  const env={};
  for(const key of ['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']){
    if(process.env[key])env[key]=process.env[key];
  }
  env.OPENCLAW_HOME='D:\\OpenClaw';
  env.OPENCLAW_STATE_DIR=DEFAULT_OPENCLAW_STATE_DIR;
  env.OPENCLAW_CONFIG_PATH=DEFAULT_OPENCLAW_CONFIG;
  return env;
}

export async function ensureOpenClawDispatch(rawEnvelope,options={}){
  const envelope=normalizeOpenClawDispatchEnvelope(rawEnvelope);
  const root=options.root||DEFAULT_DISPATCH_ROOT;
  const recordPath=dispatchFile(root,envelope.idempotencyKey);
  const processAlive=options.processAlive||defaultProcessAlive;
  const spawnWorker=options.spawnWorker||((file)=>{
    const child=spawn(process.execPath,[WORKER_PATH,file],{detached:true,windowsHide:true,stdio:'ignore',env:childEnv()});
    child.unref();
    return child;
  });
  await fs.mkdir(root,{recursive:true});
  let record=await readOpenClawDispatchRecord(recordPath);
  let created=false;
  if(!record){
    record={schema:'TIGERIQ_OPENCLAW_DISPATCH_STATE_V1',state:'prepared',attempts:0,recoveryCount:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),envelope};
    try{
      const handle=await fs.open(recordPath,'wx');
      await handle.writeFile(JSON.stringify(record,null,2),'utf8');
      await handle.close();
      created=true;
    }catch(error){
      if(error?.code!=='EEXIST')throw error;
      record=await readOpenClawDispatchRecord(recordPath);
    }
  }
  if(record?.envelope?.envelopeHash!==envelope.envelopeHash)throw new Error('OPENCLAW_IDEMPOTENCY_CONFLICT');
  if(TERMINAL.has(record.state))return {created:false,launched:false,recordPath,record};
  if(record.state==='running'&&processAlive(record.workerPid))return {created:false,launched:false,recordPath,record};
  if(record.state==='running'&&!processAlive(record.workerPid)){
    const attempts=Math.max(0,Number(record.attempts)||0);
    if(attempts>=2){
      const blocked={...record,state:'failed',failure:{kind:'orphaned_worker_retry_exhausted',message:'OPENCLAW_DISPATCH_WORKER_MISSING_AFTER_BOUNDED_RECOVERY'},updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
      await atomicWrite(recordPath,blocked);
      return {created:false,launched:false,recordPath,record:blocked};
    }
    record={...record,state:'prepared',previousWorkerPid:record.workerPid||null,workerPid:null,recoveryCount:Math.max(0,Number(record.recoveryCount)||0)+1,updatedAt:new Date().toISOString()};
    await atomicWrite(recordPath,record);
  }
  const lockPath=launchFile(recordPath);
  let lock;
  try{lock=await fs.open(lockPath,'wx');}
  catch(error){
    if(error?.code!=='EEXIST')throw error;
    record=await readOpenClawDispatchRecord(recordPath);
    return {created:false,launched:false,recordPath,record};
  }
  try{
    const child=spawnWorker(recordPath);
    const next={...record,state:'running',attempts:Math.max(0,Number(record.attempts)||0)+1,workerPid:Number(child?.pid)||null,launchedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await atomicWrite(recordPath,next);
    return {created,launched:true,recordPath,record:next};
  }finally{
    await lock.close().catch(()=>{});
    await fs.unlink(lockPath).catch(()=>{});
  }
}

export async function waitOpenClawDispatch(rawEnvelope,options={}){
  const timeoutMs=Math.max(250,Math.min(300000,Number(options.timeoutMs)||15000));
  const pollMs=Math.max(50,Math.min(2000,Number(options.pollMs)||250));
  const started=Date.now();
  const first=await ensureOpenClawDispatch(rawEnvelope,options);
  let record=first.record;
  while(!TERMINAL.has(record?.state)&&Date.now()-started<timeoutMs){
    await new Promise(resolve=>setTimeout(resolve,pollMs));
    record=await readOpenClawDispatchRecord(first.recordPath);
  }
  return {...first,record,terminal:TERMINAL.has(record?.state),elapsedMs:Date.now()-started};
}

export function parseOpenClawAgentResult(payloadText){
  const raw=String(payloadText||'').trim();
  if(!raw)return null;
  const fenced=raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate=(fenced?.[1]||raw).trim();
  try{return JSON.parse(candidate);}catch{}
  const first=candidate.indexOf('{'),last=candidate.lastIndexOf('}');
  if(first>=0&&last>first){try{return JSON.parse(candidate.slice(first,last+1));}catch{}}
  return null;
}

export function compactOpenClawCliResult(parsed,exitCode,stderr=''){
  const status=String(parsed?.status||'').toLowerCase();
  const payloadText=Array.isArray(parsed?.result?.payloads)
    ?parsed.result.payloads.map(item=>String(item?.text||'')).filter(Boolean).join('\n')
    :'';
  const meta=parsed?.result?.meta?.agentMeta||{};
  const receipt=meta?.terminalReceipt||{};
  const agentResult=parseOpenClawAgentResult(payloadText);
  return {
    exitCode:Number(exitCode),
    status:status||null,
    agentResult,
    runId:parsed?.runId||receipt?.runId||null,
    sessionId:meta?.sessionId||receipt?.sessionId||null,
    provider:meta?.provider||receipt?.effective?.provider||null,
    model:meta?.model||receipt?.effective?.model||null,
    successfulToolNames:Array.isArray(receipt?.successfulToolNames)?receipt.successfulToolNames.slice(0,32):[],
    bridgeCalls:meta?.bridgeCalls||null,
    text:clip(payloadText,6000),
    stderr:clip(stderr,2000),
  };
}

export async function runDispatchWorkerRecord(recordPath,options={}){
  const record=await readOpenClawDispatchRecord(recordPath);
  if(!record?.envelope)throw new Error('OPENCLAW_DISPATCH_RECORD_INVALID');
  if(TERMINAL.has(record.state))return record;
  const envelope=normalizeOpenClawDispatchEnvelope(record.envelope);
  const prompt=buildOpenClawPrompt(envelope);
  const entrypoint=options.entrypoint||DEFAULT_OPENCLAW_ENTRYPOINT;
  const timeoutSec=Math.max(30,Math.min(240,Number(options.timeoutSec)||180));
  const spawnCli=options.spawnCli||((args)=>spawn(process.execPath,args,{windowsHide:true,env:childEnv(),stdio:['ignore','pipe','pipe']}));
  const running={...record,state:'running',workerPid:process.pid,startedAt:record.startedAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  await atomicWrite(recordPath,running);
  const args=[entrypoint,'agent','--agent','operator-local','--session-key',envelope.sessionKey,'--message',prompt,'--json','--timeout',String(timeoutSec)];
  const child=spawnCli(args);
  let stdout='',stderr='',timedOut=false;
  child.stdout?.on?.('data',chunk=>{stdout=clip(stdout+chunk.toString(),1024*1024);});
  child.stderr?.on?.('data',chunk=>{stderr=clip(stderr+chunk.toString(),128*1024);});
  const exitCode=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{timedOut=true;child.kill();},(timeoutSec+20)*1000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);resolve(typeof code==='number'?code:-1);});
  }).catch(async error=>{
    const failed={...running,state:'failed',failure:{kind:'spawn_error',message:clip(error?.message||error,500)},updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
    await atomicWrite(recordPath,failed);return null;
  });
  if(exitCode===null)return await readOpenClawDispatchRecord(recordPath);
  let parsed=null;
  try{
    const first=stdout.indexOf('{'),last=stdout.lastIndexOf('}');
    if(first>=0&&last>first)parsed=JSON.parse(stdout.slice(first,last+1));
  }catch{}
  const result=compactOpenClawCliResult(parsed,exitCode,stderr);
  const agentStatus=String(result.agentResult?.status||'').toLowerCase();
  const successAgentStatuses=new Set(['pass','passed','ok','success','completed','done']);
  const success=!timedOut&&exitCode===0&&parsed&&!['timeout','failed','error','aborted'].includes(String(result.status||'').toLowerCase())&&result.agentResult&&successAgentStatuses.has(agentStatus);
  const finalState=success?'completed':'failed';
  const final={...running,state:finalState,result,updatedAt:new Date().toISOString(),completedAt:new Date().toISOString(),
    ...(success?{}:{failure:{kind:timedOut?'worker_timeout':(agentStatus||result.status||'openclaw_failure'),message:String(result.agentResult?.blocker||result.text||result.stderr||'OPENCLAW_DISPATCH_FAILED').slice(0,2000)}})};
  await atomicWrite(recordPath,final);
  return final;
}
