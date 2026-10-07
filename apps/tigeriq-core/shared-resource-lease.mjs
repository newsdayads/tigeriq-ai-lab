import {randomUUID} from 'node:crypto';

export const SHARED_RESOURCE_LEASE_TTL_MS=5*60*1000;
export const SHARED_RESOURCE_LEASE_HEARTBEAT_MS=30*1000;

export function sharedLeaseIdleWorkState(employeeId='',healthState='READY'){
  const employee=String(employeeId||'').trim().toUpperCase();
  const health=String(healthState||'').trim().toUpperCase();
  if(employee==='NV09'&&['READY','ONLINE'].includes(health))return 'ON_DEMAND';
  if(health==='ONLINE')return 'IDLE';
  if(health==='READY')return 'READY';
  return health||'READY';
}

export async function ensureSharedResourceLeaseTable(db){
  if(!db)return false;
  await db.query(`
create table if not exists tigeriq_ai_resource_leases(
  resource_id text primary key,
  employee_id text not null,
  lane text not null,
  work_id text not null,
  role text not null,
  lease_token text not null unique,
  lease_until timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tigeriq_ai_resource_leases_until_idx on tigeriq_ai_resource_leases(lease_until);
`);
  return true;
}

async function clearExpiredLeaseForLockedResource(client,row){
  const lease=(await client.query(
    'select * from tigeriq_ai_resource_leases where resource_id=$1 for update',
    [row.resource_id],
  )).rows[0]||null;
  if(!lease||new Date(lease.lease_until).getTime()>Date.now())return false;
  if(String(row.current_job_id||'')===String(lease.work_id||'')){
    await client.query(
      `update tigeriq_ai_resources
       set current_job_id=null,
           work_state=case
             when employee_id='NV09' and health_state in ('READY','ONLINE') then 'ON_DEMAND'
             when health_state='ONLINE' then 'IDLE'
             when health_state='READY' then 'READY'
             else health_state end,
           updated_at=now()
       where resource_id=$1 and current_job_id=$2`,
      [row.resource_id,lease.work_id],
    );
    await client.query(
      `update tigeriq_resources
       set current_job_id=null,
           work_state=case
             when employee_id='NV09' and health_state in ('READY','ONLINE') then 'ON_DEMAND'
             when health_state='ONLINE' then 'IDLE'
             when health_state='READY' then 'READY'
             else health_state end,
           updated_at=now()
       where employee_id=$1 and current_job_id=$2`,
      [row.employee_id,lease.work_id],
    );
  }
  await client.query('delete from tigeriq_ai_resource_leases where resource_id=$1 and lease_token=$2',[row.resource_id,lease.lease_token]);
  return true;
}

export async function acquireSharedResourceLease(db,{
  employeeId,
  workId,
  role='inference',
  lane='coding_lane',
  ttlMs=SHARED_RESOURCE_LEASE_TTL_MS,
  metadata={},
}={}){
  if(!db)throw new Error('SHARED_RESOURCE_LEASE_DB_REQUIRED');
  const employee=String(employeeId||'').trim().toUpperCase();
  const work=String(workId||'').trim();
  const leaseRole=String(role||'inference').trim().toLowerCase();
  const leaseLane=String(lane||'coding_lane').trim().toLowerCase();
  if(!/^NV\d{2}$/.test(employee)||!work)throw new Error('SHARED_RESOURCE_LEASE_IDENTITY_REQUIRED');
  const client=await db.connect();
  const token=randomUUID();
  const ttl=Math.max(30000,Math.min(15*60*1000,Number(ttlMs)||SHARED_RESOURCE_LEASE_TTL_MS));
  try{
    await client.query('begin');
    let row=(await client.query(
      `select * from tigeriq_ai_resources
       where employee_id=$1 and enabled=true
       order by rank,resource_id
       limit 1
       for update skip locked`,
      [employee],
    )).rows[0]||null;
    if(!row){await client.query('commit');return null;}
    await clearExpiredLeaseForLockedResource(client,row);
    row=(await client.query('select * from tigeriq_ai_resources where resource_id=$1',[row.resource_id])).rows[0]||row;
    if(row.current_job_id){await client.query('commit');return null;}
    const inserted=await client.query(
      `insert into tigeriq_ai_resource_leases(resource_id,employee_id,lane,work_id,role,lease_token,lease_until,heartbeat_at,metadata,updated_at)
       values($1,$2,$3,$4,$5,$6,now()+($7::bigint*interval '1 millisecond'),now(),$8::jsonb,now())
       on conflict(resource_id) do nothing
       returning resource_id,employee_id,lane,work_id,role,lease_token,lease_until`,
      [row.resource_id,employee,leaseLane,work,leaseRole,token,ttl,JSON.stringify(metadata||{})],
    );
    if(!inserted.rowCount){await client.query('commit');return null;}
    const claimed=await client.query(
      `update tigeriq_ai_resources
       set current_job_id=$2,work_state='BUSY',updated_at=now()
       where resource_id=$1 and current_job_id is null
       returning resource_id`,
      [row.resource_id,work],
    );
    if(!claimed.rowCount){
      await client.query('delete from tigeriq_ai_resource_leases where resource_id=$1 and lease_token=$2',[row.resource_id,token]);
      await client.query('commit');
      return null;
    }
    await client.query(
      `update tigeriq_resources
       set current_job_id=$2,work_state='BUSY',updated_at=now()
       where employee_id=$1 and (current_job_id is null or current_job_id=$2)`,
      [employee,work],
    );
    await client.query('commit');
    return inserted.rows[0];
  }catch(error){
    await client.query('rollback').catch(()=>{});
    throw error;
  }finally{client.release();}
}

export async function heartbeatSharedResourceLease(db,{resourceId,leaseToken,ttlMs=SHARED_RESOURCE_LEASE_TTL_MS}={}){
  if(!db)return false;
  const ttl=Math.max(30000,Math.min(15*60*1000,Number(ttlMs)||SHARED_RESOURCE_LEASE_TTL_MS));
  const q=await db.query(
    `update tigeriq_ai_resource_leases
     set heartbeat_at=now(),lease_until=now()+($3::bigint*interval '1 millisecond'),updated_at=now()
     where resource_id=$1 and lease_token=$2 and lease_until>now()
     returning resource_id`,
    [String(resourceId||''),String(leaseToken||''),ttl],
  );
  return q.rowCount>0;
}

export async function releaseSharedResourceLease(db,{resourceId,leaseToken}={}){
  if(!db)return false;
  const resource=String(resourceId||'').trim();
  const token=String(leaseToken||'').trim();
  if(!resource||!token)return false;
  const client=await db.connect();
  try{
    await client.query('begin');
    const resourceRow=(await client.query(
      'select resource_id,employee_id,current_job_id,health_state,work_state from tigeriq_ai_resources where resource_id=$1 for update',
      [resource],
    )).rows[0]||null;
    const lease=(await client.query(
      'select * from tigeriq_ai_resource_leases where resource_id=$1 and lease_token=$2 for update',
      [resource,token],
    )).rows[0]||null;
    if(!lease){await client.query('commit');return false;}
    if(resourceRow&&String(resourceRow.current_job_id||'')===String(lease.work_id||'')){
      await client.query(
        `update tigeriq_ai_resources
         set current_job_id=null,
             work_state=case
               when employee_id='NV09' and health_state in ('READY','ONLINE') then 'ON_DEMAND'
               when health_state='ONLINE' then 'IDLE'
               when health_state='READY' then 'READY'
               else health_state end,
             updated_at=now()
         where resource_id=$1 and current_job_id=$2`,
        [resource,lease.work_id],
      );
      await client.query(
        `update tigeriq_resources
         set current_job_id=null,
             work_state=case
               when employee_id='NV09' and health_state in ('READY','ONLINE') then 'ON_DEMAND'
               when health_state='ONLINE' then 'IDLE'
               when health_state='READY' then 'READY'
               else health_state end,
             updated_at=now()
         where employee_id=$1 and current_job_id=$2`,
        [lease.employee_id,lease.work_id],
      );
    }
    await client.query('delete from tigeriq_ai_resource_leases where resource_id=$1 and lease_token=$2',[resource,token]);
    await client.query('commit');
    return true;
  }catch(error){
    await client.query('rollback').catch(()=>{});
    throw error;
  }finally{client.release();}
}

export async function recoverExpiredSharedResourceLeases(db){
  if(!db)return [];
  const candidates=(await db.query(
    `select resource_id from tigeriq_ai_resource_leases
     where lease_until<=now()
     order by lease_until`,
  )).rows||[];
  const recovered=[];
  for(const candidate of candidates){
    const client=await db.connect();
    try{
      await client.query('begin');
      const resourceRow=(await client.query(
        'select resource_id,employee_id,current_job_id,health_state,work_state from tigeriq_ai_resources where resource_id=$1 for update',
        [candidate.resource_id],
      )).rows[0]||null;
      const lease=(await client.query(
        'select * from tigeriq_ai_resource_leases where resource_id=$1 and lease_until<=now() for update',
        [candidate.resource_id],
      )).rows[0]||null;
      if(!lease){await client.query('commit');continue;}
      if(resourceRow&&String(resourceRow.current_job_id||'')===String(lease.work_id||'')){
        await client.query(
          `update tigeriq_ai_resources
           set current_job_id=null,
               work_state=case
                 when employee_id='NV09' and health_state in ('READY','ONLINE') then 'ON_DEMAND'
                 when health_state='ONLINE' then 'IDLE'
                 when health_state='READY' then 'READY'
                 else health_state end,
               updated_at=now()
           where resource_id=$1 and current_job_id=$2`,
          [lease.resource_id,lease.work_id],
        );
        await client.query(
          `update tigeriq_resources
           set current_job_id=null,
               work_state=case
                 when employee_id='NV09' and health_state in ('READY','ONLINE') then 'ON_DEMAND'
                 when health_state='ONLINE' then 'IDLE'
                 when health_state='READY' then 'READY'
                 else health_state end,
               updated_at=now()
           where employee_id=$1 and current_job_id=$2`,
          [lease.employee_id,lease.work_id],
        );
      }
      await client.query('delete from tigeriq_ai_resource_leases where resource_id=$1 and lease_token=$2',[lease.resource_id,lease.lease_token]);
      await client.query('commit');
      recovered.push({resourceId:lease.resource_id,employeeId:lease.employee_id,workId:lease.work_id,role:lease.role,lane:lease.lane});
    }catch(error){
      await client.query('rollback').catch(()=>{});
      throw error;
    }finally{client.release();}
  }
  return recovered;
}

export async function activeSharedResourceLeases(db){
  if(!db)return [];
  const q=await db.query(
    `select resource_id,employee_id,lane,work_id,role,lease_until,heartbeat_at,metadata
     from tigeriq_ai_resource_leases
     where lease_until>now()
     order by employee_id,resource_id`,
  );
  return q.rows||[];
}

export function indexSharedResourceLeases(rows=[]){
  return new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row.resource_id||row.resourceId||''),row]).filter(([key])=>key));
}
