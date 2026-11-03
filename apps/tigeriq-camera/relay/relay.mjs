import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const write=(file,obj)=>{const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(obj),{mode:0o600});fs.renameSync(tmp,file);};
const reply=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));};
async function body(req){let n=0;let parts=[];for await (const chunk of req){n+=chunk.length;if(n>65000)throw Error('TOO_LARGE');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
export function createRelay(home) {
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(path.join(home,'updates'),{recursive:true});
  const statePath=path.join(home,'state.json'), eventsPath=path.join(home,'camera-events.ndjson');
  let state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{pair:null,clients:{},latest:null};
  const reload=()=>{ if(fs.existsSync(statePath))state=JSON.parse(fs.readFileSync(statePath,'utf8')); };
  const save=()=>write(statePath,state);let serial=Promise.resolve();
  const identify=req=>{
    const auth=req.headers.authorization||'';
    if(!auth.startsWith('Bearer '))return null;
    const incoming=Buffer.from(sha(auth.slice(7)),'hex');
    for(const [id,x] of Object.entries(state.clients)){
      const known=Buffer.from(x.hash,'hex');
      if(known.length===incoming.length&&crypto.timingSafeEqual(known,incoming))return id;
    }
    return null;
  };
  const pairCode=()=>{
    reload();
    const code=String(crypto.randomInt(100000000,999999999));
    state.pair={hash:sha(code),expires:Date.now()+24*60*60000,attempts:0};save();return code;
  };
  const publish=(file,code,name,expected)=>{
    reload();
    if(!Number.isSafeInteger(code)||code<20||code>100000||!/^1[.]0[.][0-9]{1,4}$/.test(name))throw Error('BAD_VERSION');
    if(state.latest&&code<=state.latest.versionCode)throw Error('NON_MONOTONIC_VERSION');
    const data=fs.readFileSync(file);
    if(data.length<100000||data.length>60000000)throw Error('BAD_SIZE');
    const digest=sha(data);if(digest!==String(expected).toLowerCase())throw Error('CHECKSUM_MISMATCH');
    const fileName='TigerIQ_Camera_'+code+'.apk';
    fs.writeFileSync(path.join(home,'updates',fileName),data,{flag:'wx',mode:0o600});
    state.latest={versionCode:code,versionName:name,sha256:digest,bytes:data.length,file:fileName};save();return state.latest;
  };
  const revoke=id=>{reload();if(!state.clients[id])return false;delete state.clients[id];save();return true;};
  const handle=async(req,res)=>{
    reload();
    const uri=new URL(req.url,'http://localhost');
    const pathName=uri.pathname.replace(/^[/]camera-relay(?=[/]|$)/,'');
    if(req.method==='GET'&&pathName==='/v1/health')return reply(res,200,{ok:true,service:'camera-relay'});
    if(req.method==='POST'&&pathName==='/v1/pair'){
      let data;try{data=await body(req);}catch{return reply(res,400,{error:'BAD_JSON'});}
      reload();const pair=state.pair;
      if(!pair||Date.now()>pair.expires||pair.attempts>=4)return reply(res,403,{error:'PAIR_CLOSED'});
      pair.attempts++;
      if(typeof data.code!=='string'||!/^[0-9]{9}$/.test(data.code)||sha(data.code)!==pair.hash){save();return reply(res,403,{error:'PAIR_REJECTED'});}
      state.pair=null;const token=crypto.randomBytes(32).toString('base64url');
      const id=crypto.randomBytes(8).toString('hex');
      state.clients[id]={hash:sha(token),ack:0,lastSeen:null};save();
      return reply(res,200,{ok:true,token,id});
    }
    const id=identify(req);if(!id)return reply(res,401,{error:'UNAUTHORIZED'});
    if(req.method==='GET'&&pathName==='/v1/status')
      return reply(res,200,{ok:true,ack:state.clients[id].ack,lastSeen:state.clients[id].lastSeen,latest:state.latest?.versionCode||null});
    if(req.method==='POST'&&pathName==='/v1/events'){
      let data;try{data=await body(req);}catch{return reply(res,400,{error:'BAD_JSON'});}
      if(!Number.isSafeInteger(data.seq)||data.seq<1||typeof data.events!=='string'||data.events.length>48000)
        return reply(res,400,{error:'BAD_EVENTS'});
      if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(data.events))return reply(res,400,{error:'BAD_CONTROL'});
      serial=serial.catch(()=>{}).then(()=>{
        reload();const client=state.clients[id];
        if(data.seq<=client.ack)return client.ack;
        if(data.seq!==client.ack+1)throw Error('SEQUENCE_GAP');
        if(fs.existsSync(eventsPath)&&fs.statSync(eventsPath).size>5000000){
          const old=fs.readFileSync(eventsPath);fs.writeFileSync(eventsPath,old.subarray(Math.max(0,old.length-1000000)));
        }
        fs.appendFileSync(eventsPath,JSON.stringify({receivedAt:new Date().toISOString(),id,seq:data.seq,events:data.events})+'\n',{mode:0o600});
        client.ack=data.seq;client.lastSeen=new Date().toISOString();save();return client.ack;
      });
      try{return reply(res,200,{ok:true,ack:await serial});}
      catch(e){return reply(res,e.message==='SEQUENCE_GAP'?409:500,{error:e.message==='SEQUENCE_GAP'?'SEQUENCE_GAP':'STORE_FAILED'});}
    }
    if(req.method==='GET'&&pathName==='/v1/update'){
      const x=state.latest;
      return reply(res,200,{ok:true,latest:x?{versionCode:x.versionCode,versionName:x.versionName,bytes:x.bytes,sha256:x.sha256,path:'/camera-relay/v1/update/apk'}:null});
    }
    if(req.method==='GET'&&pathName==='/v1/update/apk'){
      const x=state.latest;if(!x)return reply(res,404,{error:'NO_RELEASE'});
      const f=path.join(home,'updates',x.file);
      if(!fs.existsSync(f)||fs.statSync(f).size!==x.bytes)return reply(res,503,{error:'MISSING'});
      res.writeHead(200,{'content-type':'application/vnd.android.package-archive','content-length':x.bytes,'cache-control':'no-store'});
      return fs.createReadStream(f).pipe(res);
    }
    return reply(res,404,{error:'NOT_FOUND'});
  };
  const server=http.createServer((req,res)=>handle(req,res).catch(()=>{if(!res.headersSent)reply(res,500,{error:'INTERNAL'});else res.destroy();}));
  return {server,pairCode,publish,revoke,status:()=>{reload();return {clients:Object.fromEntries(Object.entries(state.clients).map(([k,v])=>[k,{ack:v.ack,lastSeen:v.lastSeen}])),latest:state.latest};}};
}
