import {randomUUID} from 'node:crypto';

// #4649. This adapter is NOT a worker-facing auth endpoint.
// Worker identity must be authenticated before any function is called.
export function validateScopeLease({resourceScope,workerId,workerSessionId,issueNumber,ttlMs=120000}={}){
  const scope=String(resourceScope||'').trim(),worker=String(workerId||'').trim().toUpperCase(),session=String(workerSessionId||'').trim();
  const issue=Number(issueNumber),ttl=Number(ttlMs);
  if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$/.test(scope))throw Error('SCOPE_INVALID');
  if(!/^(NV02|NV03|NV04|CORE)$/.test(worker))throw Error('WORKER_INVALID');
  if(!/^[A-Za-z0-9:_-]{8,128}$/.test(session))throw Error('SESSION_INVALID');
  if(!Number.isSafeInteger(issue)||issue<=0)throw Error('ISSUE_INVALID');
  if(!Number.isSafeInteger(ttl)||ttl<30000||ttl>600000)throw Error('TTL_INVALID');
  return {scope,worker,session,issue,ttl};
}
export async function ensureGithubScopeLeases(db){
  if(!db?.query)throw Error('DATABASE_REQUIRED');
  await db.query([
    'create table if not exists tigeriq_github_scope_leases (',
    'resource_scope text primary key,',
    'lease_id uuid not null unique,',
    'worker_id text not null,',
    'worker_session_id text not null,',
    'issue_number bigint not null,',
    'lease_until timestamptz not null,',
    'claimed_at timestamptz not null default now(),',
    'renewed_at timestamptz not null default now());',
    'create index if not exists tigeriq_github_scope_leases_until_idx',
    'on tigeriq_github_scope_leases(lease_until);',
  ].join('\n'));
  return true;
}
async function transaction(db,scope,cb){
  if(!db?.connect)throw Error('DATABASE_REQUIRED');
  const c=await db.connect();let active=false;
  try{
    await c.query('begin');active=true;
    // Separate statement after this lock has a fresh READ COMMITTED snapshot.
    // Core materializers MUST use this same advisory lock and this table.
    await c.query('select pg_advisory_xact_lock(hashtext($1))',[scope]);
    const out=await cb(c);
    await c.query('commit');active=false;
    return out;
  }catch(error){if(active)await c.query('rollback').catch(()=>{});throw error;}
  finally{c.release();}
}
export async function claimGithubScopeLease(db,input){
  const v=validateScopeLease(input);
  return transaction(db,v.scope,async c=>{
    const activeCore=await c.query(
      "select id from tigeriq_objectives where status='active' and metadata->>'resourceScope'=$1 limit 1",
      [v.scope]);
    if(activeCore.rowCount)return {acquired:false,reason:'CORE_SCOPE_ACTIVE'};
    const id=randomUUID();
    const q=await c.query(
      'insert into tigeriq_github_scope_leases(resource_scope,lease_id,worker_id,worker_session_id,issue_number,lease_until) '+
      "values($1,$2::uuid,$3,$4,$5,now()+($6::bigint*interval '1 millisecond')) "+
      'on conflict(resource_scope) do update set '+
      'lease_id=excluded.lease_id,worker_id=excluded.worker_id,worker_session_id=excluded.worker_session_id,'+
      'issue_number=excluded.issue_number,lease_until=excluded.lease_until,claimed_at=now(),renewed_at=now() '+
      'where tigeriq_github_scope_leases.lease_until<=now() '+
      'returning resource_scope,lease_id,worker_id,worker_session_id,issue_number,lease_until',
      [v.scope,id,v.worker,v.session,v.issue,v.ttl]);
    return q.rowCount===1?{acquired:true,lease:q.rows[0]}:{acquired:false,reason:'SCOPE_HELD'};
  });
}
export async function readGithubScopeLease(db,resourceScope){
  const scope=String(resourceScope||'').trim();
  if(!scope)throw Error('SCOPE_REQUIRED');
  const q=await db.query('select resource_scope,lease_id,worker_id,worker_session_id,issue_number,lease_until from tigeriq_github_scope_leases where resource_scope=$1 and lease_until>now()',[scope]);
  return q.rows[0]||null;
}
function checkedHolder(input){
  const v=validateScopeLease({...input,issueNumber:1});
  if(!/^[0-9a-fA-F-]{36}$/.test(String(input?.leaseId||'')))throw Error('LEASE_ID_INVALID');
  return {...v,id:input.leaseId};
}
export async function renewGithubScopeLease(db,input){
  const v=checkedHolder(input);
  const q=await db.query(
    "update tigeriq_github_scope_leases set lease_until=now()+($5::bigint*interval '1 millisecond'),renewed_at=now() "+
    'where resource_scope=$1 and lease_id=$2::uuid and worker_id=$3 and worker_session_id=$4 and lease_until>now() '+
    'returning resource_scope,lease_id,lease_until',
    [v.scope,v.id,v.worker,v.session,v.ttl]);
  return q.rows[0]||null;
}
export async function releaseGithubScopeLease(db,input){
  const v=checkedHolder(input);
  return transaction(db,v.scope,async c=>{
    const q=await c.query(
      'delete from tigeriq_github_scope_leases where resource_scope=$1 and lease_id=$2::uuid '+
      'and worker_id=$3 and worker_session_id=$4 returning resource_scope',
      [v.scope,v.id,v.worker,v.session]);
    return q.rowCount===1;
  });
}
export async function scopeHasLiveGithubLease(client,resourceScope){
  const q=await client.query('select 1 from tigeriq_github_scope_leases where resource_scope=$1 and lease_until>now() limit 1',[String(resourceScope||'').trim()]);
  return q.rowCount>0;
}
