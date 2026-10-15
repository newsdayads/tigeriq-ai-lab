import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ensureNv07CanaryReservationIndex,
  reserveNv07OneShotCanary,
  bindNv07CoreReservationCallback,
} from '../apps/tigeriq-core/nv07-canary-reservation.mjs';
import { NV07_CANARY_CORE_SCOPE as SCOPE } from '../apps/tigeriq-core/shared-resource-lease.mjs';

const jobId='NV07-4783-CANARY';
const sourceSha='a'.repeat(40);
const resourceId='nv07:pc01';
const idempotencyKey='nv07-one-shot-4783-key';
const pinned=()=>({jobId,sourceSha,resourceId,idempotencyKey,resourceScope:SCOPE});

function fixture(){
  const seen=new Set(),statements=[];
  let active=true,seq=0;
  const db={query:async(sql,args=[])=>{
    const q=String(sql).toLowerCase();
    statements.push({sql:String(sql),args});
    if(q.startsWith('create unique index'))return{rowCount:0,rows:[]};
    if(!q.includes('insert into tigeriq_events'))throw Error('unexpected SQL');
    if(!active||seen.has(args[0])||args[2]!==resourceId||args[1]!==sourceSha
      ||args[3]!==idempotencyKey||args[5]!==SCOPE)return{rowCount:0,rows:[]};
    seen.add(args[0]);
    return{rowCount:1,rows:[{seq:++seq}]};
  }};
  return{db,statements,seen,expire:()=>{active=false}};
}
describe('NV07 one-shot Core DB reservation is durable and fail-closed',()=>{
  it('creates a scoped unique index before runtime dispatch',async()=>{
    const f=fixture();
    expect(await ensureNv07CanaryReservationIndex(f.db)).toBe(true);
    expect(f.statements).toHaveLength(1);
    expect(f.statements[0].sql).toContain('unique index if not exists');
    expect(f.statements[0].sql).toContain("where type='NV07_CANARY_RESERVED'");
    expect(f.statements[0].sql).toContain("employee_id='NV07'");
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain('await ensureNv07CanaryReservationIndex(pool)');
  });
  it('reserves only through active exact Core lease predicates and excludes key from receipts',async()=>{
    const f=fixture();
    const result=await reserveNv07OneShotCanary(f.db,pinned());
    expect(result).toMatchObject({accepted:true,durable:true,state:'RESERVED_NOT_EXECUTED',reservationSeq:'1'});
    const q=f.statements[0];
    for(const check of [
      'l.lease_until>now()', "l.lane='nv07_bootstrap'", "l.role='canary'",
      'r.enabled=true','r.current_job_id=l.work_id',
      "l.metadata->>'workOrderId'='4783'",
      "l.metadata->>'sourceSha'=$2",
      "l.metadata->>'idempotencyKey'=$4",
      'on conflict do nothing','returning seq',
    ])expect(q.sql).toContain(check);
    expect(q.args).toHaveLength(6);
    expect(q.args[4]).not.toContain(idempotencyKey);
    expect(JSON.stringify(result)).not.toContain(idempotencyKey);
    expect(JSON.parse(q.args[4])).toMatchObject({
      state:'RESERVED_NOT_EXECUTED',workOrderId:4783,resourceScope:SCOPE,
    });
  });
  it('denies duplicate job ID under repeated or parallel callback requests',async()=>{
    const f=fixture();
    const cb=bindNv07CoreReservationCallback(f.db,{jobId,sourceSha,resourceId});
    const [a,b]=await Promise.all([
      cb({jobId,resourceScope:SCOPE,idempotencyKey}),
      cb({jobId,resourceScope:SCOPE,idempotencyKey}),
    ]);
    expect([a,b].filter(x=>x.accepted)).toHaveLength(1);
    expect(f.seen.size).toBe(1);
    expect((await cb({jobId,resourceScope:SCOPE,idempotencyKey})).accepted).toBe(false);
  });
  it('rejects invalid request, wrong scope and unpinned resource before DB access',async()=>{
    const f=fixture();
    for(const bad of [
      {jobId:'short'},{sourceSha:'latest'},{resourceId:'../wrong'},
      {idempotencyKey:'short'},{resourceScope:'OTHER'},
    ])expect((await reserveNv07OneShotCanary(f.db,{...pinned(),...bad})).accepted).toBe(false);
    const cb=bindNv07CoreReservationCallback(f.db,{jobId,sourceSha,resourceId});
    expect((await cb({jobId:'OTHER',resourceScope:SCOPE,idempotencyKey})).accepted).toBe(false);
    expect((await cb({jobId,resourceScope:'OTHER',idempotencyKey})).accepted).toBe(false);
    const missing=bindNv07CoreReservationCallback(f.db,{jobId,sourceSha});
    expect((await missing({jobId,resourceScope:SCOPE,idempotencyKey})).accepted).toBe(false);
    expect(f.statements).toHaveLength(0);
  });
  it('denies a missing or expired canonical lease',async()=>{
    const f=fixture();f.expire();
    expect(await reserveNv07OneShotCanary(f.db,pinned())).toMatchObject({
      accepted:false,code:'NV07_CANARY_LEASE_OR_ONE_SHOT_DENIED',
    });
    expect(f.seen.size).toBe(0);
  });
});
