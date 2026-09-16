import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isInteractiveDesktopSession, loadConfig, type WindowPlacement, type WorkerId } from './model.js';

const config=loadConfig(process.argv[2]);
const host='127.0.0.1';
const port=Number(process.env.TIGERIQ_CHROME_LAUNCH_BROKER_PORT||8800);
const extensionPath=resolve(process.cwd(),'apps/chrome-controller/extension');
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function body(req:IncomingMessage):Promise<Record<string,unknown>>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>:{};}
function placement(value:unknown):WindowPlacement{
  if(!value||typeof value!=='object')throw new Error('LAUNCH_PLACEMENT_REQUIRED');
  const v=value as Record<string,unknown>;const p={left:Number(v.left),top:Number(v.top),width:Number(v.width),height:Number(v.height)};
  if(!Object.values(p).every(Number.isFinite)||p.width<320||p.height<480)throw new Error('LAUNCH_PLACEMENT_INVALID');
  return p;
}
async function debugPortActive(portNumber:number){
  try{const response=await fetch(`http://127.0.0.1:${portNumber}/json/version`,{signal:AbortSignal.timeout(1200)});return response.ok;}catch{return false;}
}

async function launch(workerId:WorkerId,p:WindowPlacement){
  if(!isInteractiveDesktopSession())throw new Error('INTERACTIVE_SESSION_REQUIRED:NO_HIDDEN_CHROME');
  const worker=config.workers.find(item=>item.id===workerId&&item.enabled!==false);if(!worker)throw new Error(`WORKER_DISABLED_OR_UNKNOWN:${workerId}`);
  if(worker.debugPort&&await debugPortActive(worker.debugPort))throw new Error(`WORKER_ALREADY_RUNNING:${workerId}`);
  const args:string[]=[];const userDataDir=worker.userDataDir??config.userDataDir;
  if(userDataDir)args.push(`--user-data-dir=${userDataDir}`);
  if(worker.debugPort){
    args.push('--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${worker.debugPort}`);
  }else{
    if(!existsSync(extensionPath))throw new Error('CONTROLLER_EXTENSION_PATH_MISSING');
    args.push(`--load-extension=${extensionPath}`);
  }
  args.push(`--profile-directory=${worker.profileDirectory}`,'--disable-session-crashed-bubble','--hide-crash-restore-bubble','--new-window',`--window-position=${p.left},${p.top}`,`--window-size=${p.width},${p.height}`,worker.homeUrl);
  const child=spawn(config.chromePath,args,{detached:true,windowsHide:false,stdio:'ignore'});child.unref();
  return{ok:true,workerId,pid:child.pid??null,controllerIndependent:true,transport:worker.debugPort?'DIRECT_CDP':'EXTENSION'};
}
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/','http://127.0.0.1');
    if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,service:'chrome-launch-broker',port});
    if(req.method==='POST'&&url.pathname==='/api/launch'){
      const data=await body(req);const workerId=String(data.workerId||'') as WorkerId;
      if(!['NV02','NV03','NV04'].includes(workerId))throw new Error('LAUNCH_WORKER_INVALID');
      return json(res,202,await launch(workerId,placement(data.placement)));
    }
    return json(res,404,{ok:false,error:'NOT_FOUND'});
  }catch(error){return json(res,409,{ok:false,error:String(error instanceof Error?error.message:error)});}
});

server.listen(port,host,()=>console.log(JSON.stringify({event:'CHROME_LAUNCH_BROKER_READY',host,port,interactiveSession:isInteractiveDesktopSession()})));
