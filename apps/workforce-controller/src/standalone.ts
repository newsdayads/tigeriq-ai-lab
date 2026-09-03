import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createPgPool } from '../../../packages/work-state/src/pg-driver.js';
import { PostgresOperationalStateRepository, type SqlPoolLike } from '../../../packages/work-state/src/postgres-repository.js';
import { OperationalWorkService } from '../../../packages/work-state/src/service.js';
import { WorkforceControllerV1 } from './controller.js';

const EXPECTED_HOST='100.97.23.87';
const EXPECTED_PORT=8790;
const MAX_BODY_BYTES=512_000;

function requireProductionConfig():{host:string;port:number;databaseUrl:string;ingressToken:string}{
  const host=(process.env.TIGERIQ_WORKFORCE_HOST??'').trim();
  const port=Number(process.env.TIGERIQ_WORKFORCE_PORT??EXPECTED_PORT);
  const databaseUrl=(process.env.TIGERIQ_DATABASE_URL??'').trim();
  const ingressToken=(process.env.TIGERIQ_INGRESS_TOKEN??'').trim();
  if(host!==EXPECTED_HOST)throw new Error(`TIGERIQ_WORKFORCE_HOST must equal ${EXPECTED_HOST}`);
  if(port!==EXPECTED_PORT)throw new Error(`TIGERIQ_WORKFORCE_PORT must equal ${EXPECTED_PORT}`);
  if(!databaseUrl)throw new Error('TIGERIQ_DATABASE_URL is required for local PC01 PostgreSQL');
  if(ingressToken.length<32)throw new Error('TIGERIQ_INGRESS_TOKEN must contain at least 32 characters');
  return {host,port,databaseUrl,ingressToken};
}

async function readBody(request:IncomingMessage):Promise<Buffer>{
  const chunks:Buffer[]=[];let total=0;
  for await(const chunk of request){const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=value.length;if(total>MAX_BODY_BYTES)throw new Error('REQUEST_TOO_LARGE');chunks.push(value);}
  return Buffer.concat(chunks);
}
function headersOf(request:IncomingMessage):Record<string,string|undefined>{
  const out:Record<string,string|undefined>={};
  for(const [name,value] of Object.entries(request.headers))out[name.toLowerCase()]=Array.isArray(value)?value.join(','):value;
  return out;
}
function send(response:ServerResponse,status:number,body:Record<string,unknown>):void{
  const raw=Buffer.from(JSON.stringify(body),'utf8');
  response.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8','Content-Length':String(raw.length),'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  response.end(raw);
}

export async function startController():Promise<void>{
  const {host,port,databaseUrl,ingressToken}=requireProductionConfig();
  const pool=await createPgPool(databaseUrl,10);
  const repository=new PostgresOperationalStateRepository(pool);
  const service=new OperationalWorkService(repository);
  const recovery=await service.recoverAfterRestart(new Date().toISOString());
  const controller=new WorkforceControllerV1(pool,service,ingressToken);
  const server=createServer(async(request,response)=>{
    try{
      const body=await readBody(request);
      const result=await controller.handle({method:request.method??'GET',path:new URL(request.url??'/',`http://${host}:${port}`).pathname,headers:headersOf(request),body});
      send(response,result.status,result.body);
    }catch(error){
      if(error instanceof Error&&error.message==='REQUEST_TOO_LARGE')return send(response,413,{ok:false,error:{code:'REQUEST_TOO_LARGE',message:'request body too large',retryable:false}});
      send(response,503,{ok:false,error:{code:'CONTROLLER_UNAVAILABLE',message:'workforce controller unavailable',retryable:true}});
    }
  });
  server.on('error',error=>{console.error(JSON.stringify({event:'WORKFORCE_CONTROLLER_ERROR',message:error.message}));});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>resolve());});
  console.log(JSON.stringify({event:'WORKFORCE_CONTROLLER_V1_START',host,port,hostname:os.hostname(),postgres:'operational-state-v1',ingress:'authenticated',recovery}));
  const shutdown=async(signal:string)=>{
    console.log(JSON.stringify({event:'WORKFORCE_CONTROLLER_V1_STOP',signal}));
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    const closable=pool as SqlPoolLike&{end?:()=>Promise<void>};
    if(closable.end)await closable.end();
    process.exit(0);
  };
  process.once('SIGINT',()=>void shutdown('SIGINT'));
  process.once('SIGTERM',()=>void shutdown('SIGTERM'));
}

const invokedAsMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if(invokedAsMain)startController().catch(error=>{console.error(JSON.stringify({event:'WORKFORCE_CONTROLLER_V1_FATAL',message:error instanceof Error?error.message:'startup failed'}));process.exit(1);});
