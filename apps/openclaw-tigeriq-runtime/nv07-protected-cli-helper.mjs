import {execFile} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const ROOT=String.raw`C:\ProgramData\TigerIQNV07`;
const CWD=ROOT+String.raw`\NV07\proposal-sandbox`;
const FILE='docs/implementation/nv07-proposal.md';
const SCOPE='TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783';
const GUID=/^[a-f0-9-]{36}$/i;
const hash=data=>createHash('sha256').update(data).digest('hex');

// Defense in depth for the SYSTEM-owned immutable request. This function
// never grants a Core lease; only the Core DB may reserve/authorize a run.
export function validateNv07ProtectedInvocation(d,{parentPid,nowMs=Date.now()}={}){
 if(!d||d.schema!=='NV07_PROTECTED_CORE_INVOCATION_V1'
   ||!GUID.test(d.invocationId||'')||!Number.isSafeInteger(parentPid)
   ||parentPid<=0||d.brokerPid!==parentPid
   ||!Number.isSafeInteger(d.authorizedClientPid)||d.authorizedClientPid<=0
   ||d.workOrderId!==4783||d.resourceScope!==SCOPE
   ||!/^[a-z0-9:_-]{6,128}$/i.test(d.jobId||'')
   ||!/^[a-f0-9]{40}$/i.test(d.sourceSha||'')
   ||!/^[1-9]\d{0,15}$/.test(d.reservationSeq||'')
   ||!Number.isFinite(Date.parse(d.expiresAt))||Date.parse(d.expiresAt)<=nowMs
   ||Date.parse(d.expiresAt)-nowMs>300000||d.cwd!==CWD
   ||d.timeoutMs!==130000||d.maxOutputBytes!==262144)return false;
 const a=d.args;
 if(!Array.isArray(a)||a.length!==12||a.some(v=>typeof v!=='string'))return false;
 const fixed={0:'--output-format',1:'json',2:'--json-schema',4:'--print-timeout',
  5:'2m',6:'--sandbox',7:'--mode',8:'plan',9:'--disable-slash-commands',10:'-p'};
 if(Object.entries(fixed).some(([i,v])=>a[Number(i)]!==v))return false;
 try{
  const p=JSON.parse(a[11]),s=JSON.parse(a[3]);
  return p.task==='READ_METADATA'&&p.job_id===d.jobId
   &&p.pinned_source_sha===d.sourceSha&&Array.isArray(p.paths)
   &&p.paths.length===1&&p.paths[0]===FILE
   &&Array.isArray(p.rules)&&p.rules.length===4
   &&p.rules.every(v=>typeof v==='string'&&v.length<300)
   &&s.type==='object'&&s.additionalProperties===false
   &&JSON.stringify(s.required)===JSON.stringify(['job_id','summary','proposed_files','risks']);
 }catch{return false;}
}
async function readObject(path){
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.size>65536)throw new Error('NV07_REQUEST_FILE_INVALID');
 return JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
}
async function main(){
 const id=process.argv[2];
 if(process.platform!=='win32'||!GUID.test(id||''))throw new Error('NV07_HELPER_SCOPE_INVALID');
 const d=await readObject(ROOT+String.raw`\ipc\requests\invocation-`+id+'.json');
 if(d.invocationId!==id||!validateNv07ProtectedInvocation(d,{parentPid:process.ppid}))
  throw new Error('NV07_HELPER_BINDING_INVALID');
 const manifest=await readObject(ROOT+String.raw`\deployment.json`);
 const exe=ROOT+String.raw`\code\agy.exe`;
 const helper=ROOT+String.raw`\code\nv07-protected-cli-helper.mjs`;
 if(!/^[a-f0-9]{64}$/.test(manifest.agiSha256||'')
   ||hash(await readFile(exe))!==manifest.agiSha256
   ||hash(await readFile(helper))!==manifest.helperSha256
   ||hash(await readFile(process.execPath))!==manifest.nodeSha256)
  throw new Error('NV07_HELPER_PROVENANCE_INVALID');
 const result=await new Promise(resolve=>{
  execFile(exe,d.args,{cwd:CWD,windowsHide:true,shell:false,timeout:130000,
   maxBuffer:262144,encoding:'utf8'},(error,stdout,stderr)=>{
    resolve({exitCode:error?(Number.isInteger(error.code)?error.code:-1):0,
     stdout:typeof stdout==='string'?stdout:'',stderr:typeof stderr==='string'?stderr:'',
     timedOut:Boolean(error?.killed||error?.code==='ETIMEDOUT')});
   });
 });
 process.stdout.write(JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(()=>{process.stdout.write(JSON.stringify({
  exitCode:-1,stdout:'',stderr:'NV07_PROTECTED_HELPER_DENIED',timedOut:false}));process.exitCode=1;});
}
