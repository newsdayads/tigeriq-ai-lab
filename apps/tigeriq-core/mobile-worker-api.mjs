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
function canonicalJson(value) {
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
  }
  return JSON.stringify(value??null);
}
export function mobileTaskResultDigest(result={}) {
  return sha256(canonicalJson(result&&typeof result==='object'?result:{}));
}
export function mobileTaskTerminalDecision({status='',currentDigest='',incomingResult={}}={}) {
  const terminal=['completed','failed'].includes(String(status||'').toLowerCase());
  const digest=mobileTaskResultDigest(incomingResult);
  if(!terminal)return {accept:true,idempotent:false,conflict:false,digest};
  if(String(currentDigest||'')===digest)return {accept:false,idempotent:true,conflict:false,digest};
  return {accept:false,idempotent:false,conflict:true,digest};
}
export function mobileTaskLeaseFresh({currentLeaseId='',leaseId='',leaseExpiresAt='',now=Date.now()}={}) {
  const current=String(currentLeaseId||'');
  const incoming=String(leaseId||'');
  const expiresAt=new Date(leaseExpiresAt).getTime();
  return Boolean(current&&incoming&&current===incoming&&Number.isFinite(expiresAt)&&expiresAt>Number(now));
}
export function verifyCoreEnqueueAuth(req,coreAuthToken='') {
  const expected=String(coreAuthToken||'').trim();
  if(!expected)return false;
  const match=String(req?.headers?.authorization||'').match(/^Bearer\s+(.+)$/i);
  const presented=String(match?.[1]||'').trim();
  if(!presented)return false;
  return safeHexEqual(sha256(presented),sha256(expected));
}
export const GATE_C_V020_VERSION='0.20.0-update-lease-guard';
export const GATE_C_V020_COUNT=10;
const gateCV020Prefix=(employeeId)=>`gate-c:v020:${String(employeeId||'').trim()}:`;
export function gateCV020TaskSpecs(employeeId){
  const id=String(employeeId||'').trim();
  if(!id)throw new Error('GATE_C_V020_EMPLOYEE_REQUIRED');
  return Array.from({length:GATE_C_V020_COUNT},(_,offset)=>{
    const index=offset+1;
    const token=`TIGERIQ_GATE_C_OK_${index}`;
    return {
      index,
      idempotencyKey:`${gateCV020Prefix(id)}${String(index).padStart(2,'0')}`,
      prompt:`TigerIQ Gate C job ${index}/${GATE_C_V020_COUNT}. Return exactly: ${token}`,
      expectedToken:token,
    };
  });
}
export function gateCV020Aggregate(rows=[],employeeId=''){
  const specs=gateCV020TaskSpecs(employeeId);
  const byKey=new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row?.idempotency_key||''),row]));
  const jobs=specs.map(spec=>{
    const row=byKey.get(spec.idempotencyKey);
    const status=String(row?.status||'missing').toLowerCase();
    const output=row?.result&&typeof row.result==='object'&&!Array.isArray(row.result)
      ? (row.result.output&&typeof row.result.output==='object'&&!Array.isArray(row.result.output)?row.result.output:{})
      : {};
    const sendCount=Number(output.sendCount);
    const duplicateSendCount=Number(output.duplicateSendCount);
    const valid=status==='completed'
      && Number.isFinite(sendCount)&&sendCount===1
      && Number.isFinite(duplicateSendCount)&&duplicateSendCount===0
      && String(output.validatedToken||'')===spec.expectedToken;
    return {index:spec.index,status,attempts:Number(row?.attempts||0),sendCount:Number.isFinite(sendCount)?sendCount:null,duplicateSendCount:Number.isFinite(duplicateSendCount)?duplicateSendCount:null,valid};
  });
  const completed=jobs.filter(job=>job.status==='completed').length;
  const failed=jobs.filter(job=>job.status==='failed').length;
  const pending=jobs.filter(job=>!['completed','failed'].includes(job.status)).length;
  const invalid=jobs.filter(job=>job.status==='completed'&&!job.valid).length;
  return {
    expected:GATE_C_V020_COUNT,
    taskCount:jobs.filter(job=>job.status!=='missing').length,
    completed,failed,pending,invalid,
    pass:completed===GATE_C_V020_COUNT&&failed===0&&pending===0&&invalid===0,
    jobs,
  };
}

export const GATE_C_V021_VERSION='0.21.0-packageinstaller-stream-fix';
export const GATE_C_V021_COUNT=10;
const gateCV021Prefix=(employeeId)=>`gate-c:v021:${String(employeeId||'').trim()}:`;
export function gateCV021TaskSpecs(employeeId){
  const id=String(employeeId||'').trim();
  if(!id)throw new Error('GATE_C_V021_EMPLOYEE_REQUIRED');
  return Array.from({length:GATE_C_V021_COUNT},(_,offset)=>{
    const index=offset+1;
    const token=`TIGERIQ_GATE_C_OK_${index}`;
    return {
      index,
      idempotencyKey:`${gateCV021Prefix(id)}${String(index).padStart(2,'0')}`,
      prompt:`TigerIQ Gate C job ${index}/${GATE_C_V021_COUNT}. Return exactly: ${token}`,
      expectedToken:token,
    };
  });
}
export function gateCV021Aggregate(rows=[],employeeId=''){
  const specs=gateCV021TaskSpecs(employeeId);
  const byKey=new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row?.idempotency_key||''),row]));
  const jobs=specs.map(spec=>{
    const row=byKey.get(spec.idempotencyKey);
    const status=String(row?.status||'missing').toLowerCase();
    const output=row?.result&&typeof row.result==='object'&&!Array.isArray(row.result)
      ? (row.result.output&&typeof row.result.output==='object'&&!Array.isArray(row.result.output)?row.result.output:{})
      : {};
    const sendCountRaw=output.sendCount;
    const duplicateSendCountRaw=output.duplicateSendCount;
    const recoveryCountRaw=output.recoveryCount;
    const sendCountValid=Number.isInteger(sendCountRaw)&&sendCountRaw===1;
    const duplicateSendCountValid=Number.isInteger(duplicateSendCountRaw)&&duplicateSendCountRaw===0;
    const recoveryCountValid=Number.isInteger(recoveryCountRaw)&&recoveryCountRaw>=0;
    const sendCount=sendCountValid?sendCountRaw:null;
    const duplicateSendCount=duplicateSendCountValid?duplicateSendCountRaw:null;
    const recoveryCount=recoveryCountValid?recoveryCountRaw:null;
    const valid=status==='completed'
      && sendCountValid
      && duplicateSendCountValid
      && recoveryCountValid
      && String(output.validatedToken||'')===spec.expectedToken;
    return {
      index:spec.index,status,attempts:Number(row?.attempts||0),
      sendCount,
      duplicateSendCount,
      recoveryCount,
      valid
    };
  });
  const completed=jobs.filter(job=>job.status==='completed').length;
  const failed=jobs.filter(job=>job.status==='failed').length;
  const pending=jobs.filter(job=>!['completed','failed'].includes(job.status)).length;
  const invalid=jobs.filter(job=>job.status==='completed'&&!job.valid).length;
  const sendCount=jobs.reduce((sum,job)=>sum+(Number.isFinite(job.sendCount)?job.sendCount:0),0);
  const duplicateSendCount=jobs.reduce((sum,job)=>sum+(Number.isFinite(job.duplicateSendCount)?job.duplicateSendCount:0),0);
  const recoveryCount=jobs.reduce((sum,job)=>sum+(Number.isFinite(job.recoveryCount)?job.recoveryCount:0),0);
  return {
    expected:GATE_C_V021_COUNT,
    taskCount:jobs.filter(job=>job.status!=='missing').length,
    completed,failed,pending,invalid,sendCount,duplicateSendCount,recoveryCount,
    pass:completed===GATE_C_V021_COUNT&&failed===0&&pending===0&&invalid===0,
    jobs,
  };
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
    create table if not exists tigeriq_mobile_evidence(
      node_id text not null,
      employee_id text not null,
      kind text not null,
      run_id text not null,
      seq int not null,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      primary key(node_id,run_id,seq)
    );
    create table if not exists tigeriq_mobile_tasks(
      task_id text primary key,
      idempotency_key text unique not null,
      target_node_id text not null,
      employee_id text not null,
      provider text not null,
      prompt text not null,
      expected_token text not null,
      status text not null default 'queued',
      lease_id text,
      lease_expires_at timestamptz,
      run_id text not null,
      attempts int not null default 0,
      result jsonb,
      result_digest text,
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (status in ('queued','leased','completed','failed'))
    );
    create index if not exists tigeriq_mobile_tasks_claim_idx
      on tigeriq_mobile_tasks(target_node_id,status,created_at);
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
function isLoopbackPeer(req){
  const raw=String(req.socket?.remoteAddress||'').replace(/^::ffff:/,'');
  return raw==='127.0.0.1'||raw==='::1';
}
async function gateCV020Target(pool,{requireFresh=false}={}){
  const result=await pool.query(
    `select node_id,employee_id,provider,agent_version,last_seen_at
       from tigeriq_mobile_devices
      where revoked=false and agent_version=$1
      order by last_seen_at desc nulls last`,
    [GATE_C_V020_VERSION]
  );
  if(result.rowCount!==1)return {ok:false,error:result.rowCount===0?'gate_c_v020_device_unavailable':'gate_c_v020_device_ambiguous'};
  const row=result.rows[0];
  const lastSeenAt=row.last_seen_at?new Date(row.last_seen_at).getTime():NaN;
  const online=Number.isFinite(lastSeenAt)&&Date.now()-lastSeenAt<=120_000;
  if(requireFresh&&!online)return {ok:false,error:'gate_c_v020_device_stale'};
  return {ok:true,row,online,lastSeenAt:Number.isFinite(lastSeenAt)?new Date(lastSeenAt).toISOString():null};
}
async function gateCV021Target(pool,{requireFresh=false}={}){
  const result=await pool.query(
    `select node_id,employee_id,provider,agent_version,last_seen_at
       from tigeriq_mobile_devices
      where revoked=false and agent_version=$1
      order by last_seen_at desc nulls last`,
    [GATE_C_V021_VERSION]
  );
  if(result.rowCount!==1)return {ok:false,error:result.rowCount===0?'gate_c_v021_device_unavailable':'gate_c_v021_device_ambiguous'};
  const row=result.rows[0];
  const lastSeenAt=row.last_seen_at?new Date(row.last_seen_at).getTime():NaN;
  const online=Number.isFinite(lastSeenAt)&&Date.now()-lastSeenAt<=120_000;
  if(requireFresh&&!online)return {ok:false,error:'gate_c_v021_device_stale'};
  return {ok:true,row,online,lastSeenAt:Number.isFinite(lastSeenAt)?new Date(lastSeenAt).toISOString():null};
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
export function createMobileWorkerApi({pool,event=async()=>{},coreAuthToken=''}) {
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

    if(req.method==='POST'&&url.pathname==='/api/mobile/gate-c/v020/enqueue'){
      if(!isLoopbackPeer(req))return send(res,403,{ok:false,error:'loopback_required'});
      if(!verifyCoreEnqueueAuth(req,coreAuthToken))return send(res,401,{ok:false,error:'core_auth_required'});
      const target=await gateCV020Target(pool,{requireFresh:true});
      if(!target.ok)return send(res,409,target);
      const employeeId=String(target.row.employee_id);
      const targetNodeId=String(target.row.node_id);
      const specs=gateCV020TaskSpecs(employeeId);
      const client=await pool.connect();
      let created=0;
      try{
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))',[gateCV020Prefix(employeeId)]);
        for(const spec of specs){
          const prior=(await client.query('select task_id from tigeriq_mobile_tasks where idempotency_key=$1 limit 1',[spec.idempotencyKey])).rows[0];
          if(prior)continue;
          const taskId='MT-'+randomToken(12),runId='MR-'+randomToken(12);
          const inserted=await client.query(
            `insert into tigeriq_mobile_tasks(task_id,idempotency_key,target_node_id,employee_id,provider,prompt,expected_token,run_id)
             select $1,$2,node_id,employee_id,provider,$3,$4,$5
               from tigeriq_mobile_devices
              where employee_id=$6 and node_id=$7 and revoked=false and agent_version=$8
              limit 1`,
            [taskId,spec.idempotencyKey,spec.prompt,spec.expectedToken,runId,employeeId,targetNodeId,GATE_C_V020_VERSION]
          );
          if(inserted.rowCount!==1)throw new Error('GATE_C_V020_TARGET_CHANGED');
          created++;
        }
        await client.query('commit');
      }catch(error){
        try{await client.query('rollback')}catch{}
        throw error;
      }finally{client.release();}
      await event('MOBILE_GATE_C_V020_ENQUEUED',{employeeId,count:GATE_C_V020_COUNT,created});
      return send(res,created?201:200,{
        ok:true,status:'GATE_C_V020_ENQUEUED',version:GATE_C_V020_VERSION,
        employeeId,count:GATE_C_V020_COUNT,created,existing:GATE_C_V020_COUNT-created,
      });
    }
    if(req.method==='GET'&&url.pathname==='/api/mobile/gate-c/v020/status'){
      if(!isLoopbackPeer(req))return send(res,403,{ok:false,error:'loopback_required'});
      if(!verifyCoreEnqueueAuth(req,coreAuthToken))return send(res,401,{ok:false,error:'core_auth_required'});
      const target=await gateCV020Target(pool);
      if(!target.ok)return send(res,409,target);
      const employeeId=String(target.row.employee_id);
      const keys=gateCV020TaskSpecs(employeeId).map(spec=>spec.idempotencyKey);
      const result=await pool.query(
        `select idempotency_key,status,attempts,result
           from tigeriq_mobile_tasks
          where employee_id=$1 and idempotency_key=any($2::text[])`,
        [employeeId,keys]
      );
      const aggregate=gateCV020Aggregate(result.rows,employeeId);
      return send(res,200,{
        ok:true,status:'GATE_C_V020_STATUS',version:GATE_C_V020_VERSION,
        employeeId,online:target.online,lastSeenAt:target.lastSeenAt,...aggregate,
      });
    }

    if(req.method==='POST'&&url.pathname==='/api/mobile/gate-c/v021/enqueue'){
      if(!isLoopbackPeer(req))return send(res,403,{ok:false,error:'loopback_required'});
      if(!verifyCoreEnqueueAuth(req,coreAuthToken))return send(res,401,{ok:false,error:'core_auth_required'});
      const target=await gateCV021Target(pool,{requireFresh:true});
      if(!target.ok)return send(res,409,target);
      const employeeId=String(target.row.employee_id);
      const targetNodeId=String(target.row.node_id);
      const specs=gateCV021TaskSpecs(employeeId);
      const client=await pool.connect();
      let created=0;
      try{
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))',[gateCV021Prefix(employeeId)]);
        for(const spec of specs){
          const prior=(await client.query('select task_id from tigeriq_mobile_tasks where idempotency_key=$1 limit 1',[spec.idempotencyKey])).rows[0];
          if(prior)continue;
          const taskId='MT-'+randomToken(12),runId='MR-'+randomToken(12);
          const inserted=await client.query(
            `insert into tigeriq_mobile_tasks(task_id,idempotency_key,target_node_id,employee_id,provider,prompt,expected_token,run_id)
             select $1,$2,node_id,employee_id,provider,$3,$4,$5
               from tigeriq_mobile_devices
              where employee_id=$6 and node_id=$7 and revoked=false and agent_version=$8
              limit 1`,
            [taskId,spec.idempotencyKey,spec.prompt,spec.expectedToken,runId,employeeId,targetNodeId,GATE_C_V021_VERSION]
          );
          if(inserted.rowCount!==1)throw new Error('GATE_C_V021_TARGET_CHANGED');
          created++;
        }
        await client.query('commit');
      }catch(error){
        try{await client.query('rollback')}catch{}
        throw error;
      }finally{client.release();}
      await event('MOBILE_GATE_C_V021_ENQUEUED',{employeeId,count:GATE_C_V021_COUNT,created});
      return send(res,created?201:200,{
        ok:true,status:'GATE_C_V021_ENQUEUED',version:GATE_C_V021_VERSION,
        employeeId,count:GATE_C_V021_COUNT,created,existing:GATE_C_V021_COUNT-created,
      });
    }
    if(req.method==='GET'&&url.pathname==='/api/mobile/gate-c/v021/status'){
      if(!isLoopbackPeer(req))return send(res,403,{ok:false,error:'loopback_required'});
      if(!verifyCoreEnqueueAuth(req,coreAuthToken))return send(res,401,{ok:false,error:'core_auth_required'});
      const target=await gateCV021Target(pool);
      if(!target.ok)return send(res,409,target);
      const employeeId=String(target.row.employee_id);
      const keys=gateCV021TaskSpecs(employeeId).map(spec=>spec.idempotencyKey);
      const result=await pool.query(
        `select idempotency_key,status,attempts,result
           from tigeriq_mobile_tasks
          where employee_id=$1 and idempotency_key=any($2::text[])`,
        [employeeId,keys]
      );
      const aggregate=gateCV021Aggregate(result.rows,employeeId);
      return send(res,200,{
        ok:true,status:'GATE_C_V021_STATUS',version:GATE_C_V021_VERSION,
        employeeId,online:target.online,lastSeenAt:target.lastSeenAt,...aggregate,
      });
    }

    if(req.method==='POST'&&url.pathname==='/api/mobile/tasks/enqueue'){
      if(!isTailnetPeer(req)||!['127.0.0.1','::1'].includes(String(req.socket?.remoteAddress||'').replace(/^::ffff:/,''))){
        return send(res,403,{ok:false,error:'loopback_required'});
      }
      if(!verifyCoreEnqueueAuth(req,coreAuthToken))return send(res,401,{ok:false,error:'core_auth_required'});
      const input=await body(req);
      const employeeId=text(input.employeeId,80);
      const idempotencyKey=text(input.idempotencyKey,160);
      const prompt=text(input.prompt,4000);
      const expectedToken=text(input.expectedToken,500);
      if(!employeeId||!idempotencyKey||!prompt||!expectedToken)return send(res,400,{ok:false,error:'invalid_mobile_task'});
      const client=await pool.connect();
      try{
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))',[idempotencyKey]);
        const prior=(await client.query('select * from tigeriq_mobile_tasks where idempotency_key=$1 limit 1',[idempotencyKey])).rows[0];
        if(prior){
          await client.query('commit');
          return send(res,200,{ok:true,idempotent:true,task:{taskId:prior.task_id,runId:prior.run_id,status:prior.status}});
        }
        const target=(await client.query('select node_id,employee_id,provider from tigeriq_mobile_devices where employee_id=$1 and revoked=false limit 1',[employeeId])).rows[0];
        if(!target){await client.query('rollback');return send(res,404,{ok:false,error:'mobile_employee_not_found'});}
        const taskId='MT-'+randomToken(12),runId='MR-'+randomToken(12);
        await client.query(
          `insert into tigeriq_mobile_tasks(task_id,idempotency_key,target_node_id,employee_id,provider,prompt,expected_token,run_id)
           values($1,$2,$3,$4,$5,$6,$7,$8)`,
          [taskId,idempotencyKey,target.node_id,target.employee_id,target.provider,prompt,expectedToken,runId]
        );
        await client.query('commit');
        await event('MOBILE_TASK_ENQUEUED',{taskId,runId,nodeId:target.node_id,employeeId:target.employee_id,idempotencyKey});
        return send(res,201,{ok:true,idempotent:false,task:{taskId,runId,status:'queued'}});
      }catch(error){
        try{await client.query('rollback')}catch{}
        throw error;
      }finally{client.release();}
    }
    if(req.method==='GET'&&url.pathname==='/api/mobile/tasks/status'){
      const remote=String(req.socket?.remoteAddress||'').replace(/^::ffff:/,'');
      if(!['127.0.0.1','::1'].includes(remote))return send(res,403,{ok:false,error:'loopback_required'});
      const employeeId=text(url.searchParams.get('employeeId'),80);
      const limit=Math.max(1,Math.min(100,Number(url.searchParams.get('limit')||20)));
      const result=employeeId
        ? await pool.query('select task_id,idempotency_key,target_node_id,employee_id,status,run_id,attempts,result,created_at,updated_at,completed_at from tigeriq_mobile_tasks where employee_id=$1 order by created_at desc limit $2',[employeeId,limit])
        : await pool.query('select task_id,idempotency_key,target_node_id,employee_id,status,run_id,attempts,result,created_at,updated_at,completed_at from tigeriq_mobile_tasks order by created_at desc limit $1',[limit]);
      return send(res,200,{ok:true,tasks:result.rows});
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
    if(req.method==='POST'&&url.pathname==='/api/mobile/tasks/lease'){
      const client=await pool.connect();
      try{
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))',[device.node_id]);
        let task=(await client.query(
          `select * from tigeriq_mobile_tasks
           where target_node_id=$1 and employee_id=$2 and status='leased' and lease_expires_at>now()
           order by updated_at desc limit 1 for update`,
          [device.node_id,device.employee_id]
        )).rows[0];
        let reused=true;
        if(!task){
          reused=false;
          task=(await client.query(
            `select * from tigeriq_mobile_tasks
             where target_node_id=$1 and employee_id=$2
               and (status='queued' or (status='leased' and lease_expires_at<=now()))
             order by created_at asc limit 1 for update skip locked`,
            [device.node_id,device.employee_id]
          )).rows[0];
          if(!task){await client.query('commit');return send(res,200,{ok:true,leased:false});}
          const leaseId='ML-'+randomToken(18);
          task=(await client.query(
            `update tigeriq_mobile_tasks
             set status='leased',lease_id=$2,lease_expires_at=now()+interval '5 minutes',
                 attempts=attempts+1,updated_at=now()
             where task_id=$1
             returning *`,
            [task.task_id,leaseId]
          )).rows[0];
        }
        await client.query('commit');
        if(!reused)await event('MOBILE_TASK_LEASED',{taskId:task.task_id,runId:task.run_id,nodeId:device.node_id,employeeId:device.employee_id,attempt:task.attempts});
        return send(res,200,{ok:true,leased:true,reused,task:{
          taskId:task.task_id,leaseId:task.lease_id,runId:task.run_id,provider:task.provider,
          prompt:task.prompt,expectedToken:task.expected_token,leaseExpiresAt:task.lease_expires_at
        }});
      }catch(error){
        try{await client.query('rollback')}catch{}
        throw error;
      }finally{client.release();}
    }
    if(req.method==='POST'&&url.pathname==='/api/mobile/tasks/renew'){
      const input=await body(req);
      const taskId=text(input.taskId,160),leaseId=text(input.leaseId,160);
      if(!taskId||!leaseId)return send(res,400,{ok:false,error:'invalid_mobile_lease'});
      const renewed=await pool.query(
        `update tigeriq_mobile_tasks
         set lease_expires_at=now()+interval '5 minutes',updated_at=now()
         where task_id=$1 and lease_id=$2 and target_node_id=$3 and employee_id=$4
           and status='leased' and lease_expires_at>now()
         returning task_id,lease_expires_at`,
        [taskId,leaseId,device.node_id,device.employee_id]
      );
      if(!renewed.rowCount)return send(res,409,{ok:false,error:'mobile_lease_stale'});
      return send(res,200,{ok:true,taskId,leaseExpiresAt:renewed.rows[0].lease_expires_at});
    }
    if(req.method==='POST'&&url.pathname==='/api/mobile/tasks/result'){
      const input=await body(req);
      const taskId=text(input.taskId,160),leaseId=text(input.leaseId,160);
      const result=input.result&&typeof input.result==='object'?input.result:{};
      if(!taskId||!leaseId)return send(res,400,{ok:false,error:'invalid_mobile_result'});
      const client=await pool.connect();
      try{
        await client.query('begin');
        const task=(await client.query('select * from tigeriq_mobile_tasks where task_id=$1 for update',[taskId])).rows[0];
        if(!task){await client.query('rollback');return send(res,404,{ok:false,error:'mobile_task_not_found'});}
        if(task.target_node_id!==device.node_id||task.employee_id!==device.employee_id){
          await client.query('rollback');return send(res,409,{ok:false,error:'mobile_task_wrong_worker'});
        }
        if(!mobileTaskLeaseFresh({currentLeaseId:task.lease_id,leaseId,leaseExpiresAt:task.lease_expires_at})){
          await client.query('rollback');return send(res,409,{ok:false,error:'mobile_lease_stale'});
        }
        const decision=mobileTaskTerminalDecision({status:task.status,currentDigest:task.result_digest,incomingResult:result});
        if(decision.idempotent){await client.query('commit');return send(res,200,{ok:true,idempotent:true,taskId,status:task.status});}
        if(decision.conflict){await client.query('rollback');return send(res,409,{ok:false,error:'mobile_task_result_conflict'});}
        if(task.status!=='leased'){
          await client.query('rollback');return send(res,409,{ok:false,error:'mobile_lease_stale'});
        }
        const terminal=String(result.status||'completed').toLowerCase()==='failed'?'failed':'completed';
        await client.query(
          `update tigeriq_mobile_tasks set status=$2,result=$3::jsonb,result_digest=$4,
             completed_at=now(),updated_at=now() where task_id=$1`,
          [taskId,terminal,JSON.stringify(result),decision.digest]
        );
        await client.query('commit');
        await event('MOBILE_TASK_RESULT',{taskId,runId:task.run_id,nodeId:device.node_id,employeeId:device.employee_id,status:terminal});
        return send(res,200,{ok:true,idempotent:false,taskId,status:terminal});
      }catch(error){
        try{await client.query('rollback')}catch{}
        throw error;
      }finally{client.release();}
    }
    if(req.method==='POST'&&url.pathname==='/api/mobile/evidence'){
      const input=await body(req);
      const kind=text(input.kind,80);
      const runId=text(input.runId,160);
      const seq=Number(input.seq||0);
      const payload=input.payload&&typeof input.payload==='object'?input.payload:{};
      if(!kind||!runId||!Number.isInteger(seq)||seq<1)return send(res,400,{ok:false,error:'invalid_mobile_evidence'});
      const inserted=await pool.query(
        'insert into tigeriq_mobile_evidence(node_id,employee_id,kind,run_id,seq,payload) values($1,$2,$3,$4,$5,$6::jsonb) on conflict do nothing returning run_id',
        [device.node_id,device.employee_id,kind,runId,seq,JSON.stringify(payload)]
      );
      if(inserted.rowCount>0){
        await event('MOBILE_WORKER_EVIDENCE',{nodeId:device.node_id,employeeId:device.employee_id,kind,runId,seq});
      }
      return send(res,200,{ok:true,idempotent:inserted.rowCount===0});
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
