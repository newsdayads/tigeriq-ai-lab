import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isInteractiveDesktopSession, loadConfig, type WindowPlacement, type WorkerId } from './model.js';
import { spawnDetachedProcess } from './process-lifecycle.js';
import { classifyWorkerPresence, processProbeFromCount, type WorkerPresence, type WorkerProcessProbe } from './worker-presence.js';

type LaunchRecord={pid:number|null;launchedAt:string};
type BrokerLaunchState={
  schemaVersion:'tigeriq.chrome-launch-broker-state.v1';
  workers:Partial<Record<WorkerId,LaunchRecord>>;
};

const config=loadConfig(process.argv[2]);
const host='127.0.0.1';
const port=Number(process.env.TIGERIQ_CHROME_LAUNCH_BROKER_PORT||8800);
mkdirSync(config.logDir,{recursive:true});
const launchStatePath=resolve(config.logDir,'chrome-launch-broker-state.json');

function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function body(req:IncomingMessage):Promise<Record<string,unknown>>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>:{};}
function placement(value:unknown):WindowPlacement{
  if(!value||typeof value!=='object')throw new Error('LAUNCH_PLACEMENT_REQUIRED');
  const v=value as Record<string,unknown>;const p={left:Number(v.left),top:Number(v.top),width:Number(v.width),height:Number(v.height)};
  if(!Object.values(p).every(Number.isFinite)||p.width<320||p.height<480)throw new Error('LAUNCH_PLACEMENT_INVALID');
  return p;
}
function emptyLaunchState():BrokerLaunchState{return{schemaVersion:'tigeriq.chrome-launch-broker-state.v1',workers:{}};}
function loadLaunchState():BrokerLaunchState{
  if(!existsSync(launchStatePath))return emptyLaunchState();
  try{
    const parsed=JSON.parse(readFileSync(launchStatePath,'utf8')) as Partial<BrokerLaunchState>;
    if(parsed.schemaVersion!=='tigeriq.chrome-launch-broker-state.v1'||!parsed.workers||typeof parsed.workers!=='object')return emptyLaunchState();
    return parsed as BrokerLaunchState;
  }catch{return emptyLaunchState();}
}
let launchState=loadLaunchState();
function saveLaunchState(){
  writeFileSync(launchStatePath,`${JSON.stringify(launchState,null,2)}\n`,'utf8');
}
async function debugPortActive(portNumber:number){
  try{const response=await fetch(`http://127.0.0.1:${portNumber}/json/version`,{signal:AbortSignal.timeout(1200)});return response.ok;}catch{return false;}
}
function pidAlive(pid:number|null|undefined){
  if(!pid||!Number.isInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);return true;}
  catch(error){return (error as NodeJS.ErrnoException)?.code==='EPERM';}
}
function psLiteral(value:string){return value.replace(/'/g,"''");}
function windowsChromeProcessProbe(workerId:WorkerId):WorkerProcessProbe{
  const worker=config.workers.find(item=>item.id===workerId&&item.enabled!==false);
  if(!worker?.debugPort)return 'UNKNOWN';
  if(process.platform!=='win32'){
    const recorded=launchState.workers[workerId];
    return processProbeFromCount(undefined,recorded?pidAlive(recorded.pid):undefined);
  }
  const userDataDir=worker.userDataDir??config.userDataDir;
  const flags=[`--remote-debugging-port=${worker.debugPort}`];
  if(userDataDir)flags.push(`--user-data-dir=${userDataDir}`);
  const clauses=flags.map((flag)=>`$_.CommandLine -and $_.CommandLine.Contains('${psLiteral(flag)}')`).join(' -and ');
  const script=`$rows=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { ${clauses} }); [Console]::Out.Write($rows.Count)`;
  try{
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:2500,windowsHide:true}).trim();
    const count=Number(output);
    if(Number.isInteger(count))return processProbeFromCount(count,undefined);
  }catch{}
  const recorded=launchState.workers[workerId];
  return processProbeFromCount(undefined,recorded?pidAlive(recorded.pid):undefined);
}
async function presence(workerId:WorkerId):Promise<{ok:true;workerId:WorkerId;presence:WorkerPresence;debugPortActive:boolean;processProbe:WorkerProcessProbe;pid:number|null}>{
  const worker=config.workers.find(item=>item.id===workerId&&item.enabled!==false);if(!worker)throw new Error(`WORKER_DISABLED_OR_UNKNOWN:${workerId}`);
  if(!worker.debugPort)throw new Error('DIRECT_CDP_DEBUG_PORT_REQUIRED');
  const cdp=await debugPortActive(worker.debugPort);
  const processProbe=cdp?'PRESENT':windowsChromeProcessProbe(workerId);
  const workerPresence=classifyWorkerPresence(cdp,processProbe);
  return{ok:true,workerId,presence:workerPresence,debugPortActive:cdp,processProbe,pid:launchState.workers[workerId]?.pid??null};
}

async function launch(workerId:WorkerId,p:WindowPlacement){
  if(!isInteractiveDesktopSession())throw new Error('INTERACTIVE_SESSION_REQUIRED:NO_HIDDEN_CHROME');
  const worker=config.workers.find(item=>item.id===workerId&&item.enabled!==false);if(!worker)throw new Error(`WORKER_DISABLED_OR_UNKNOWN:${workerId}`);
  const observed=await presence(workerId);
  if(observed.presence==='RUNNING')throw new Error(`WORKER_ALREADY_RUNNING:${workerId}`);
  if(observed.presence!=='ABSENT')throw new Error(`WORKER_PROCESS_AMBIGUOUS:${workerId}`);
  if(!worker.debugPort)throw new Error('DIRECT_CDP_DEBUG_PORT_REQUIRED');
  const args:string[]=[];const userDataDir=worker.userDataDir??config.userDataDir;
  if(userDataDir)args.push(`--user-data-dir=${userDataDir}`);
  args.push('--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${worker.debugPort}`);
  args.push(`--profile-directory=${worker.profileDirectory}`,'--disable-session-crashed-bubble','--hide-crash-restore-bubble','--new-window',`--window-position=${p.left},${p.top}`,`--window-size=${p.width},${p.height}`,worker.homeUrl);
  const child=spawnDetachedProcess(config.chromePath,args,{windowsHide:false});
  launchState={...launchState,workers:{...launchState.workers,[workerId]:{pid:child.pid,launchedAt:new Date().toISOString()}}};
  saveLaunchState();
  return{ok:true,workerId,pid:child.pid,controllerIndependent:true,transport:'DIRECT_CDP'};
}
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/','http://127.0.0.1');
    if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,service:'chrome-launch-broker',port});
    const presenceMatch=url.pathname.match(/^\/api\/presence\/(NV02|NV03|NV04)$/);
    if(req.method==='GET'&&presenceMatch)return json(res,200,await presence(presenceMatch[1] as WorkerId));
    if(req.method==='POST'&&url.pathname==='/api/launch'){
      const data=await body(req);const workerId=String(data.workerId||'') as WorkerId;
      if(!['NV02','NV03','NV04'].includes(workerId))throw new Error('LAUNCH_WORKER_INVALID');
      return json(res,202,await launch(workerId,placement(data.placement)));
    }
    return json(res,404,{ok:false,error:'NOT_FOUND'});
  }catch(error){return json(res,409,{ok:false,error:String(error instanceof Error?error.message:error)});}
});

server.listen(port,host,()=>console.log(JSON.stringify({event:'CHROME_LAUNCH_BROKER_READY',host,port,interactiveSession:isInteractiveDesktopSession(),launchStatePath})));
