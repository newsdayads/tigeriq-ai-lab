// PC01 read-only quota preflight. No credentials, prompts or source files are written.
// Run on demand through the existing authenticated TigerIQ PC01 MCP/Core surface.
import {spawn} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {codexQuotaSnapshot,antigravityQuotaSnapshots} from './owner-cli-quota-routing.mjs';

const LOCAL=process.env.LOCALAPPDATA||'';
const agyExe=join(LOCAL,'agy','bin','agy.exe');
const codexBin=join(LOCAL,'OpenAI','Codex','bin');
function execLimited(exe,args,{timeoutMs=15000,maxOutput=262144}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','ignore']});
    let data='',settled=false;
    const finish=(err,val)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();err?reject(err):resolve(val);};
    const timer=setTimeout(()=>finish(new Error('CLI_TIMEOUT')),timeoutMs);
    child.on('error',finish);
    child.stdout.on('data',chunk=>{data+=String(chunk);if(data.length>maxOutput)finish(new Error('CLI_OUTPUT_LIMIT'));});
    child.on('close',code=>code===0?finish(null,data):finish(new Error('CLI_EXIT_'+code)));
  });
}
export async function locateCodexExe(root=codexBin){
  const folders=(await readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory());
  for(const folder of folders.reverse()){
    const path=join(root,folder.name,'codex.exe');
    try{const {stat}=await import('node:fs/promises');if((await stat(path)).isFile())return path;}catch{}
  }
  throw new Error('CODEX_EXE_NOT_FOUND');
}
export async function inspectAgy({exe=agyExe,observedAt=new Date().toISOString(),exec=execLimited}={}){
  const [json,models]=await Promise.all([
    exec(exe,['-p','/usage','--mode','plan','--output-format','json','--print-timeout','12s']),
    exec(exe,['models'])
  ]);
  const payload=JSON.parse(String(json).trim());
  const snapshots=antigravityQuotaSnapshots(payload,{observedAt});
  if(!snapshots.length)throw new Error('AGY_QUOTA_UNKNOWN');
  return {authenticated:true,observedAt,snapshots,models:String(models).split(/\r?\n/)
    .map(line=>line.split('\t')[0].trim()).filter(x=>/^[a-z0-9._-]{2,100}$/.test(x))};
}
export async function inspectCodex({exe,observedAt=new Date().toISOString(),timeoutMs=15000,spawnFn=spawn}={}){
  if(!exe)throw new Error('CODEX_EXE_REQUIRED');
  return new Promise((resolve,reject)=>{
    const p=spawnFn(exe,['app-server'],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    const collected=new Map();let pending='',settled=false;
    const finish=(err)=>{if(settled)return;settled=true;clearTimeout(timer);p.kill();
      if(err){reject(err);return;}
      const quota=codexQuotaSnapshot({result:collected.get(6)},{observedAt});
      if(collected.get(5)?.account?.type!=='chatgpt'){reject(new Error('CODEX_CHATGPT_AUTH_REQUIRED'));return;}
      if(!quota.quotaKnown){reject(new Error('CODEX_QUOTA_UNKNOWN'));return;}
      const models=(collected.get(7)?.data||[]).map(x=>String(x.model||x.id||'')).filter(Boolean);
      resolve({authenticated:true,observedAt,snapshots:[quota],models});
    };
    const timer=setTimeout(()=>finish(new Error('CODEX_QUOTA_TIMEOUT')),timeoutMs);
    p.on('error',finish);p.on('close',()=>{if(!settled)finish(new Error('CODEX_APP_SERVER_CLOSED'));});
    p.stdout.on('data',chunk=>{
      pending+=String(chunk);
      if(pending.length>262144){finish(new Error('CODEX_OUTPUT_LIMIT'));return;}
      while(pending.includes('\n')){
        const index=pending.indexOf('\n');const line=pending.slice(0,index);pending=pending.slice(index+1);
        let message;try{message=JSON.parse(line);}catch{continue;}
        if(message.id===5||message.id===6||message.id===7){
          if(message.error){finish(new Error('CODEX_READ_FAILED'));return;}
          collected.set(message.id,message.result);
          if(collected.has(5)&&collected.has(6)&&collected.has(7)){finish();return;}
        }
      }
    });
    for(const obj of [
      {method:'initialize',id:0,params:{clientInfo:{name:'tigeriq_quota_preflight',title:'TigerIQ Quota Preflight',version:'1.0.0'}}},
      {method:'initialized',params:{}},
      {method:'account/read',id:5,params:{refreshToken:false}},
      {method:'account/rateLimits/read',id:6},
      {method:'model/list',id:7,params:{limit:100,includeHidden:false}}
    ])p.stdin.write(JSON.stringify(obj)+'\n');
  });
}
export async function liveOwnerCliQuotaProbe(){
  const started=new Date().toISOString(),out={schema:'TIGERIQ_OWNER_AI_QUOTA_V1',observedAt:started};
  try{out.antigravity=await inspectAgy({observedAt:started});}catch(err){out.antigravity={authenticated:false,error:String(err.message||'AGY_UNKNOWN')};}
  try{out.codex=await inspectCodex({exe:await locateCodexExe(),observedAt:started});}catch(err){out.codex={authenticated:false,error:String(err.message||'CODEX_UNKNOWN')};}
  return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await liveOwnerCliQuotaProbe();
  console.log(JSON.stringify(result));
  if(!result.antigravity?.authenticated&&!result.codex?.authenticated)process.exitCode=1;
}
