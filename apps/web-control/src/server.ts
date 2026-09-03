import { randomBytes,timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage,ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir,readFile,rename,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseContinuousControl,parseContinuousGoalQueue,type ContinuousGoalQueue } from '../../continuous-operations/src/core.js';
import { readWebControlSnapshot,defaultWebControlSnapshotPath } from './file-source.js';
import { renderWebControlWithControls } from './render-controls.js';

export interface WebControlServerOptions {
  host?:string;
  port?:number;
  commandSecret?:string;
  snapshotPath?:string;
  continuousControlPath?:string;
  continuousGoalsPath?:string;
  secureCookies?:boolean;
}
type Session={csrf:string;createdAt:number};
const sessions=new Map<string,Session>();
const SESSION_TTL_MS=12*60*60*1000;
const MAX_BODY_BYTES=20_000;
const controlDefault='F:\\TigerIQ\\Runtime\\continuous-operations-v1\\control.json';
const goalsDefault='F:\\TigerIQ\\Runtime\\continuous-operations-v1\\goals.json';
const headers={
  'cache-control':'no-store',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy':'no-referrer',
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'permissions-policy':'camera=(), microphone=(), geolocation=()'
};
function respond(response:ServerResponse,status:number,type:string,body:string,extra:Record<string,string>={}):void{response.writeHead(status,{...headers,...extra,'content-type':type});response.end(body);}
function redirect(response:ServerResponse,location:string,extra:Record<string,string>={}):void{response.writeHead(303,{...headers,...extra,location});response.end();}
function equal(a:string,b:string):boolean{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
function cookies(request:IncomingMessage):Record<string,string>{const raw=request.headers.cookie??'';return Object.fromEntries(raw.split(';').map(part=>part.trim()).filter(Boolean).map(part=>{const index=part.indexOf('=');return index<0?[part,'']:[part.slice(0,index),decodeURIComponent(part.slice(index+1))];}));}
function sessionFor(request:IncomingMessage):Session|null{const id=cookies(request).tigeriq_web_session;if(!id)return null;const session=sessions.get(id);if(!session||Date.now()-session.createdAt>SESSION_TTL_MS){sessions.delete(id);return null;}return session;}
function cleanSessions():void{const now=Date.now();for(const [id,session] of sessions)if(now-session.createdAt>SESSION_TTL_MS)sessions.delete(id);}
async function form(request:IncomingMessage):Promise<URLSearchParams>{const chunks:Buffer[]=[];let total=0;for await(const chunk of request){const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=value.length;if(total>MAX_BODY_BYTES)throw new Error('PAYLOAD_TOO_LARGE');chunks.push(value);}return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));}
async function readJson(file:string):Promise<unknown>{return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}
async function atomicJson(file:string,value:unknown):Promise<void>{await mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(value,null,2),'utf8');await rename(temp,file);}
function assertLoopback(host:string):void{if(!['127.0.0.1','::1','localhost'].includes(host))throw new Error('WEB_CONTROL_LOOPBACK_ONLY');}
function requireCsrf(request:IncomingMessage,body:URLSearchParams):Session{const session=sessionFor(request);if(!session)throw new Error('UNAUTHORIZED');if(!equal(body.get('csrf')??'',session.csrf))throw new Error('CSRF_REJECTED');return session;}
function messageCode(value:string|null):string|undefined{const messages:Record<string,string>={paused:'Continuous Operations đã PAUSE.',resumed:'Continuous Operations đã RESUME.',goal_added:'Goal đã được thêm vào Queue.',logged_out:'Đã đăng xuất.'};return value?messages[value]:undefined;}

export async function startWebControlServer(options:WebControlServerOptions={}){
  const host=options.host??'127.0.0.1';assertLoopback(host);
  const port=options.port??8788;
  const secret=options.commandSecret??process.env.TIGERIQ_COMMAND_SECRET??'';
  const snapshotPath=options.snapshotPath??process.env.TIGERIQ_WEB_CONTROL_SNAPSHOT??defaultWebControlSnapshotPath;
  const controlPath=options.continuousControlPath??process.env.TIGERIQ_CONTINUOUS_CONTROL??controlDefault;
  const goalsPath=options.continuousGoalsPath??process.env.TIGERIQ_CONTINUOUS_GOALS??goalsDefault;
  const secureCookies=options.secureCookies??process.env.TIGERIQ_SECURE_COOKIES!=='0';

  const server=createServer(async(request,response)=>{
    cleanSessions();
    const url=new URL(request.url??'/','http://localhost');
    try{
      if(request.method==='GET'&&url.pathname==='/health')return respond(response,200,'application/json; charset=utf-8',JSON.stringify({ok:true,service:'tigeriq-web-control',bind:'loopback'}));
      if(request.method==='GET'&&url.pathname==='/api/control'){
        const snapshot=await readWebControlSnapshot(snapshotPath);
        return respond(response,200,'application/json; charset=utf-8',JSON.stringify(snapshot?{available:true,snapshot}:{available:false}));
      }
      if(request.method==='POST'&&url.pathname==='/login'){
        if(!secret)return respond(response,503,'application/json; charset=utf-8',JSON.stringify({error:'write_auth_not_configured'}));
        const body=await form(request);if(!equal(body.get('secret')??'',secret))return respond(response,401,'application/json; charset=utf-8',JSON.stringify({error:'invalid_credentials'}));
        const id=randomBytes(32).toString('base64url');sessions.set(id,{csrf:randomBytes(24).toString('base64url'),createdAt:Date.now()});
        const secure=secureCookies?'; Secure':'';
        return redirect(response,'/',{'set-cookie':`tigeriq_web_session=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`});
      }
      if(request.method==='POST'&&url.pathname==='/logout'){
        const body=await form(request);requireCsrf(request,body);const id=cookies(request).tigeriq_web_session;if(id)sessions.delete(id);
        const secure=secureCookies?'; Secure':'';return redirect(response,'/?message=logged_out',{'set-cookie':`tigeriq_web_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`});
      }
      if(request.method==='POST'&&(url.pathname==='/control/pause'||url.pathname==='/control/resume')){
        if(!secret)return respond(response,503,'application/json; charset=utf-8',JSON.stringify({error:'write_auth_not_configured'}));
        const body=await form(request);requireCsrf(request,body);
        const current=parseContinuousControl(await readJson(controlPath));
        const paused=url.pathname.endsWith('/pause');
        await atomicJson(controlPath,{...current,paused});
        return redirect(response,`/?message=${paused?'paused':'resumed'}`);
      }
      if(request.method==='POST'&&url.pathname==='/goals'){
        if(!secret)return respond(response,503,'application/json; charset=utf-8',JSON.stringify({error:'write_auth_not_configured'}));
        const body=await form(request);requireCsrf(request,body);
        const queue=parseContinuousGoalQueue(await readJson(goalsPath));
        const dependencies=(body.get('dependencies')??'').split(',').map(value=>value.trim()).filter(Boolean);
        const candidate:ContinuousGoalQueue={version:1,goals:[...queue.goals,{goalId:(body.get('goalId')??'').trim(),goal:(body.get('goal')??'').trim(),priority:(body.get('priority')??'P1').trim() as 'P0'|'P1'|'P2'|'P3',mode:(body.get('mode')??'ai').trim() as 'ai'|'acceptance',enabled:true,dependencies}]};
        const validated=parseContinuousGoalQueue(candidate);
        await atomicJson(goalsPath,validated);
        return redirect(response,'/?message=goal_added');
      }
      if(request.method==='GET'&&url.pathname==='/'){
        const snapshot=await readWebControlSnapshot(snapshotPath);
        const session=sessionFor(request);
        return respond(response,200,'text/html; charset=utf-8',renderWebControlWithControls(snapshot,{writeConfigured:Boolean(secret),authenticated:Boolean(session),csrf:session?.csrf,message:messageCode(url.searchParams.get('message'))}));
      }
      return respond(response,404,'application/json; charset=utf-8',JSON.stringify({error:'not_found'}));
    }catch(error){
      const code=error instanceof Error?error.message:'WEB_CONTROL_ERROR';
      if(code==='UNAUTHORIZED')return respond(response,401,'application/json; charset=utf-8',JSON.stringify({error:'unauthorized'}));
      if(code==='CSRF_REJECTED')return respond(response,403,'application/json; charset=utf-8',JSON.stringify({error:'csrf_rejected'}));
      if(code==='PAYLOAD_TOO_LARGE')return respond(response,413,'application/json; charset=utf-8',JSON.stringify({error:'payload_too_large'}));
      return respond(response,503,'application/json; charset=utf-8',JSON.stringify({error:'web_control_unavailable'}));
    }
  });

  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const address=server.address() as AddressInfo;
  return {url:`http://${address.address}:${address.port}`,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
