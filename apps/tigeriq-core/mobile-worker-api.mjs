import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';

const jsonHeaders = {'content-type':'application/json','cache-control':'no-store'};
const challengeTtlMs = 5 * 60_000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
function safeHexEqual(leftHex, rightHex) {
  try {
    const left=Buffer.from(leftHex,'hex'), right=Buffer.from(rightHex,'hex');
    return left.length===right.length && timingSafeEqual(left,right);
  } catch { return false; }
}
function text(value, max=160) {
  const out=String(value??'').trim();
  return out.length>max?out.slice(0,max):out;
}
function stringList(value,maxItems=16,maxLength=80) {
  return Array.isArray(value) ? value.map(v=>text(v,maxLength)).filter(Boolean).slice(0,maxItems) : [];
}
export function normalizeMobileProvider(value) {
  return String(value||'').trim().toLowerCase()==='gemini'?'Gemini':'ChatGPT';
}
export function verifyMobilePairingProof({publicKey,challenge,proof}) {
  try {
    const der=Buffer.from(String(publicKey||''),'base64');
    const signature=Buffer.from(String(proof||''),'base64url');
    if(der.length<64||der.length>2048||signature.length<48||signature.length>256)return false;
    const key=createPublicKey({key:der,format:'der',type:'spki'});
    if(key.asymmetricKeyType!=='ec')return false;
    if(key.asymmetricKeyDetails?.namedCurve && key.asymmetricKeyDetails.namedCurve!=='prime256v1')return false;
    return verify('sha256',Buffer.from(String(challenge||''),'utf8'),key,signature);
  } catch { return false; }
}
export async function initMobileWorkerTables(pool) {
  await pool.query(`
    create table if not exists tigeriq_mobile_pairing_challenges(
      challenge_id text primary key,
      challenge text not null,
      challenge_hash text not null,
      expires_at timestamptz not null,
      used boolean not null default false,
      created_at timestamptz not null default now()
    );
    create table if not exists tigeriq_mobile_devices(
      node_id text primary key,
      public_key text not null,
      public_key_fingerprint text not null,
      credential_id text unique not null,
      token_hash text not null,
      employee_id text unique not null,
      department text not null,
      role text not null,
      provider text not null,
      platform text,
      agent_version text,
      capabilities jsonb not null default '[]'::jsonb,
      battery_pct int,
      last_seen_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      revoked boolean not null default false
    );
    create index if not exists tigeriq_mobile_devices_seen_idx on tigeriq_mobile_devices(last_seen_at desc);
  `);
}
async function body(req,maxBytes=65536) {
  let raw='';
  for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw,'utf8')>maxBytes)throw new Error('BODY_TOO_LARGE');}
  return raw?JSON.parse(raw):{};
}
function send(res,status,payload) {
  res.writeHead(status,jsonHeaders);res.end(JSON.stringify(payload));return true;
}
function isTailnetPeer(req) {
  const raw=String(req.socket?.remoteAddress||'').replace(/^::ffff:/,'');
  if(raw==='127.0.0.1'||raw==='::1')return true;
  const parts=raw.split('.').map(Number);
  return parts.length===4 && parts.every(Number.isInteger) && parts[0]===100 && parts[1]>=64 && parts[1]<=127;
}
function mobileAuthHeaders(req) {
  const credentialId=text(req.headers['x-tigeriq-credential-id'],160);
  const match=String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);
  return {credentialId,token:match?match[1]:''};
}
async function authenticate(pool,req) {
  const {credentialId,token}=mobileAuthHeaders(req);
  if(!credentialId||!token)return null;
  const result=await pool.query('select * from tigeriq_mobile_devices where credential_id=$1 and revoked=false limit 1',[credentialId]);
  const row=result.rows[0];
  if(!row||!safeHexEqual(row.token_hash,sha256(token)))return null;
  return row;
}
async function allocateEmployeeId(client) {
  for(let n=101;n<=9999;n++){
    const id=`NV${n}`;
    const mobile=(await client.query('select 1 from tigeriq_mobile_devices where employee_id=$1 limit 1',[id])).rowCount>0;
    const core=(await client.query('select 1 from tigeriq_ai_resources where employee_id=$1 limit 1',[id])).rowCount>0;
    if(!mobile&&!core)return id;
  }
  throw new Error('MOBILE_EMPLOYEE_ID_EXHAUSTED');
}
function releaseManifestPath() {
  return process.env.TIGERIQ_MOBILE_RELEASE_MANIFEST?.trim() || 'D:\\TigerIQ\\Runtime\\MobileWorker\\release.json';
}
export function readMobileReleaseManifest(path=releaseManifestPath()) {
  try {
    if(!existsSync(path))return {available:false};
    const parsed=JSON.parse(readFileSync(path,'utf8'));
    const versionCode=Number(parsed.versionCode||0);
    if(!Number.isInteger(versionCode)||versionCode<1)return {available:false};
    return {
      available:true,
      versionCode,
      versionName:text(parsed.versionName,80),
      sha256:text(parsed.sha256,80).toLowerCase(),
      signerSha256:text(parsed.signerSha256,120).toUpperCase(),
      fileName:text(parsed.fileName,160),
      releaseNotes:text(parsed.releaseNotes,1000),
      channel:text(parsed.channel||'DEV',20).toUpperCase(),
      downloadPath:'/api/mobile/update/apk',
      publishedAt:text(parsed.publishedAt,80),
      apkPath:text(parsed.apkPath,500),
      driveUrl:text(parsed.driveUrl,500),
    };
  } catch { return {available:false}; }
}
export function createMobileWorkerApi({pool,event=async()=>{}}) {
  return async function handleMobile(req,res,url) {
    if(!url.pathname.startsWith('/api/mobile/'))return false;

    if(req.method==='GET'&&url.pathname==='/api/mobile/health'){
      return send(res,200,{ok:true,service:'tigeriq-core-mobile',controlPlane:'TigerIQ Core',port:Number(process.env.TIGERIQ_CORE_PORT||8795),apiVersion:'mobile-v1'});
    }

    if(req.method==='POST'&&url.pathname==='/api/mobile/pairing-challenge'){
      if(!isTailnetPeer(req))return send(res,403,{ok:false,error:'tailnet_required'});
      await pool.query('delete from tigeriq_mobile_pairing_challenges where expires_at<now()-interval \'1 hour\'');
      const challengeId=randomToken(18), challenge=randomToken(32);
      const expiresAt=new Date(Date.now()+challengeTtlMs).toISOString();
      await pool.query(
        'insert into tigeriq_mobile_pairing_challenges(challenge_id,challenge,challenge_hash,expires_at) values($1,$2,$3,$4)',
        [challengeId,challenge,sha256(challenge),expiresAt]
      );
      return send(res,201,{ok:true,pairing:{challengeId,challenge,expiresAt}});
    }

    if(req.method==='POST'&&url.pathname==='/api/mobile/pair'){
      if(!isTailnetPeer(req))return send(res,403,{ok:false,error:'tailnet_required'});
      const input=await body(req);
      const challengeId=text(input.challengeId,160), nodeId=text(input.nodeId,160);
      const publicKey=text(input.publicKey,4096), proof=text(input.proof,1024);
      if(!challengeId||!nodeId||!publicKey||!proof)return send(res,400,{ok:false,error:'invalid_pairing_request'});
      const client=await pool.connect();
      try{
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))',[nodeId]);
        const challengeResult=await client.query('select * from tigeriq_mobile_pairing_challenges where challenge_id=$1 for update',[challengeId]);
        const challengeRow=challengeResult.rows[0];
        if(!challengeRow||challengeRow.used||new Date(challengeRow.expires_at).getTime()<Date.now()){
          await client.query('rollback');return send(res,409,{ok:false,error:'pairing_challenge_invalid'});
        }
        if(!safeHexEqual(challengeRow.challenge_hash,sha256(challengeRow.challenge))){
          await client.query('rollback');return send(res,409,{ok:false,error:'pairing_challenge_integrity'});
        }
        if(!verifyMobilePairingProof({publicKey,challenge:challengeRow.challenge,proof})){
          await client.query('rollback');return send(res,401,{ok:false,error:'pairing_proof_invalid'});
        }
        const fingerprint=sha256(Buffer.from(publicKey,'base64'));
        const existing=(await client.query('select * from tigeriq_mobile_devices where node_id=$1 for update',[nodeId])).rows[0];
        if(existing&&existing.public_key_fingerprint!==fingerprint){
          await client.query('rollback');return send(res,409,{ok:false,error:'node_key_mismatch'});
        }
        const credentialId=randomToken(18), token=randomToken(32);
        const provider=normalizeMobileProvider(input.provider);
        const capabilities=stringList(input.capabilities);
        const platform=text(input.platform,240), agentVersion=text(input.agentVersion,80);
        let employeeId=existing?.employee_id;
        if(!employeeId)employeeId=await allocateEmployeeId(client);
        const department=existing?.department||'Engineering';
        const role=existing?.role||'Android Worker Pilot';
        await client.query(`
          insert into tigeriq_mobile_devices(
            node_id,public_key,public_key_fingerprint,credential_id,token_hash,employee_id,department,role,provider,platform,agent_version,capabilities,last_seen_at,updated_at,revoked
          ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now(),now(),false)
          on conflict(node_id) do update set
            public_key=excluded.public_key,public_key_fingerprint=excluded.public_key_fingerprint,
            credential_id=excluded.credential_id,token_hash=excluded.token_hash,provider=excluded.provider,
            platform=excluded.platform,agent_version=excluded.agent_version,capabilities=excluded.capabilities,
            last_seen_at=now(),updated_at=now(),revoked=false
        `,[nodeId,publicKey,fingerprint,credentialId,sha256(token),employeeId,department,role,provider,platform,agentVersion,JSON.stringify(capabilities)]);
        await client.query('update tigeriq_mobile_pairing_challenges set used=true where challenge_id=$1',[challengeId]);
        await client.query('commit');
        await event('MOBILE_WORKER_PAIRED',{employeeId,nodeId,provider,agentVersion});
        return send(res,201,{ok:true,credential:{credentialId,token,nodeId},employee:{employeeId,department,role,provider,nodeId},controlPlane:'TigerIQ Core'});
      }catch(error){
        try{await client.query('rollback')}catch{}
        throw error;
      }finally{client.release();}
    }

    const device=await authenticate(pool,req);
    if(!device)return send(res,401,{ok:false,error:'mobile_unauthorized'});

    if(req.method==='POST'&&url.pathname==='/api/mobile/assignment'){
      const input=await body(req);
      const provider=normalizeMobileProvider(input.provider||device.provider);
      const capabilities=stringList(input.capabilities);
      await pool.query(
        'update tigeriq_mobile_devices set provider=$2,capabilities=case when $3::jsonb=\'[]\'::jsonb then capabilities else $3::jsonb end,updated_at=now() where node_id=$1',
        [device.node_id,provider,JSON.stringify(capabilities)]
      );
      return send(res,200,{ok:true,employee:{employeeId:device.employee_id,department:device.department,role:device.role,provider,nodeId:device.node_id}});
    }
    if(req.method==='POST'&&url.pathname==='/api/mobile/heartbeat'){
      const input=await body(req);
      const batteryPct=Math.max(0,Math.min(100,Number(input.batteryPct||0)));
      const agentVersion=text(input.agentVersion,80);
      const provider=normalizeMobileProvider(input.provider||device.provider);
      await pool.query('update tigeriq_mobile_devices set battery_pct=$2,agent_version=coalesce(nullif($3,\'\'),agent_version),provider=$4,last_seen_at=now(),updated_at=now() where node_id=$1',[device.node_id,batteryPct,agentVersion,provider]);
      return send(res,200,{ok:true,nodeId:device.node_id,employeeId:device.employee_id,serverTime:new Date().toISOString()});
    }
    if(req.method==='GET'&&url.pathname==='/api/mobile/update/manifest'){
      const manifest=readMobileReleaseManifest();
      const safe={...manifest};delete safe.apkPath;
      return send(res,200,{ok:true,...safe});
    }
    if(req.method==='GET'&&url.pathname==='/api/mobile/update/apk'){
      const manifest=readMobileReleaseManifest();
      if(!manifest.available||!manifest.apkPath||!existsSync(manifest.apkPath))return send(res,404,{ok:false,error:'mobile_release_unavailable'});
      const size=statSync(manifest.apkPath).size;
      res.writeHead(200,{
        'content-type':'application/vnd.android.package-archive',
        'content-length':String(size),
        'cache-control':'no-store',
        'content-disposition':`attachment; filename="${manifest.fileName||'TIQ-Worker.apk'}"`
      });
      createReadStream(manifest.apkPath).pipe(res);return true;
    }
    return send(res,404,{ok:false,error:'mobile_route_not_found'});
  };
}
