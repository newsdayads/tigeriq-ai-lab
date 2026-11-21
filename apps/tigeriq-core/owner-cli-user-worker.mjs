// User-context Task Scheduler worker. Runs as the interactive owner, NOT as SYSTEM.
// The only supported actions are bounded quota reads and model inference in plan/read-only mode.
// Admin/OS mutation, arbitrary tools, source editing and shell execution are not supported.
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {liveOwnerCliQuotaProbe} from './owner-cli-quota-probe.mjs';
import {defaultExecuteOwnerCli} from './owner-cli-dispatch.mjs';
import {OWNER_CLI_BRIDGE_ROOT,validateOwnerCliBridgeRequest,ownerCliNeedsUserSession} from './owner-cli-user-bridge.mjs';

const ROOT=OWNER_CLI_BRIDGE_ROOT;
const SCHEMA='TIGERIQ_OWNER_CLI_BRIDGE_V1';

export function verifyOwnerWorkerIdentity(env=process.env){
  if(process.platform!=='win32'||ownerCliNeedsUserSession(env)
    ||String(env.USERNAME||'').toLowerCase()!=='wdragons12x'
    ||!/\\users\\wdragons12x\\appdata\\local$/i.test(String(env.LOCALAPPDATA||'')))
    throw new Error('OWNER_CLI_INTERACTIVE_USER_REQUIRED');
  return true;
}

export async function processOwnerCliUserRequest({read=fs.readFile,write=fs.writeFile,
  rename=fs.rename,stat=fs.lstat,root=ROOT,probe=liveOwnerCliQuotaProbe,
  execute=defaultExecuteOwnerCli,at=Date.now}={}){
  verifyOwnerWorkerIdentity();
  if(root!==ROOT)throw new Error('OWNER_CLI_BRIDGE_ROOT_UNTRUSTED');
  const requestPath=join(root,'request.json');
  const resultPath=join(root,'response.json');
  const st=await stat(requestPath);
  if(!st.isFile()||st.isSymbolicLink()||st.size>65536)
    throw new Error('OWNER_CLI_BRIDGE_REQUEST_UNTRUSTED');
  const raw=await read(requestPath,'utf8');
  const request=JSON.parse(String(raw).replace(/^\uFEFF/,''));
  const safe=validateOwnerCliBridgeRequest(request,{nowMs:at()});
  let result;
  try{
    const value=safe.action==='quota'
      ? await probe()
      : await execute({provider:safe.provider,model:safe.model,prompt:safe.prompt,timeoutMs:safe.timeoutMs});
    result={schema:SCHEMA,requestId:safe.requestId,ok:true,value};
  }catch(error){
    result={schema:SCHEMA,requestId:safe.requestId,ok:false,
      error:String(error?.message||error).slice(0,240)};
  }
  const tempPath=join(root,'response.'+safe.requestId+'.tmp');
  await write(tempPath,JSON.stringify(result),{flag:'wx',mode:0o600});
  await rename(tempPath,resultPath);
  return {ok:result.ok,requestId:safe.requestId};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await processOwnerCliUserRequest();}
  catch(error){
    // Do not leak CLI credentials or prompt text to the Task Scheduler console.
    process.stderr.write('OWNER_CLI_USER_BRIDGE_ERROR: '+String(error?.message||error).slice(0,140)+'\n');
    process.exitCode=1;
  }
}
