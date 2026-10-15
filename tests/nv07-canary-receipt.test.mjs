import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {ensureNv07CanaryReceiptIndex,storeNv07VerifiedCanaryReceipt,bindNv07CoreReceiptCallback} from '../apps/tigeriq-core/nv07-canary-receipt.mjs';

const jobId='NV07-4783-CANARY',sourceSha='a'.repeat(40),resourceId='nv07:pc01';
const idempotencyKey='nv07-canary-owner-4783-once',outputHash='b'.repeat(64);
const good=()=>({workOrderId:4783,jobId,sourceSha,idempotencyKey,outputHash,proposedFileCount:1,reservationSeq:'11',state:'BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE',resourceId});
function fixture(){
  const records=new Set(),queries=[];let lease=true,seq=45,reservationExists=true;
  return {
    db:{query:async(sql,args=[])=>{
      queries.push({sql,args});
      if(sql.startsWith('create unique index'))return{rows:[],rowCount:0};
      if(!sql.includes('insert into tigeriq_events'))throw Error('unexpected SQL');
      if(!lease||!reservationExists||args[6]!=='11'||records.has(args[0])
        ||args[2]!==resourceId||args[1]!==sourceSha)return{rows:[],rowCount:0};
      records.add(args[0]);return{rows:[{seq:++seq}],rowCount:1};
    }},
    queries,records,expire(){lease=false},noReservation(){reservationExists=false},
  };
}
describe('NV07 trusted Core durable receipt from real reservation',()=>{
  it('installs exact one-receipt-per-job index at Core startup',async()=>{
    const f=fixture();
    expect(await ensureNv07CanaryReceiptIndex(f.db)).toBe(true);
    expect(f.queries[0].sql).toContain("where type='NV07_CANARY_RECEIPT'");
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain('await ensureNv07CanaryReceiptIndex(pool)');
  });
  it('writes only digest metadata backed by exact reservation and active lease',async()=>{
    const f=fixture(),r=await storeNv07VerifiedCanaryReceipt(f.db,good());
    expect(r).toMatchObject({accepted:true,durable:true,eventSeq:'46'});
    expect(r.evidenceRef).toBe('tigeriq_events:NV07_CANARY_RECEIPT:46');
    const q=f.queries[0];
    for(const s of [
      "r.seq=$7::bigint","r.type='NV07_CANARY_RESERVED'",
      "r.data->>'idempotencyHash'=$5","r.data->>'sourceSha'=$2",
      "l.lease_until>now()","l.metadata->>'action'='READ_METADATA'",
      "a.enabled=true","a.current_job_id=$1","on conflict do nothing",
    ])expect(q.sql).toContain(s);
    const evidence=JSON.parse(q.args[5]);
    expect(evidence).toMatchObject({outputHash,sourceSha,resourceScope:'TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783'});
    expect(JSON.stringify(evidence)).not.toContain(idempotencyKey);
    expect(JSON.stringify(r)).not.toContain(idempotencyKey);
    expect(JSON.stringify(r)).not.toContain(outputHash);
  });
  it('rejects duplicate receipts and concurrent replay',async()=>{
    const f=fixture(),cb=bindNv07CoreReceiptCallback(f.db,{jobId,sourceSha,resourceId});
    const [a,b]=await Promise.all([cb(good()),cb(good())]);
    expect([a,b].filter(x=>x.accepted)).toHaveLength(1);
    expect(f.records.size).toBe(1);
    expect((await cb(good())).accepted).toBe(false);
  });
  it('rejects invalid input, mistaken binding and wrong reservation without DB calls',async()=>{
    const f=fixture();
    const changes=[
      {jobId:'short'},{sourceSha:'latest'},{resourceId:'../other'},
      {idempotencyKey:'short'},{outputHash:'no-hash'},
      {proposedFileCount:-1},{proposedFileCount:13},
      {reservationSeq:'0'},{reservationSeq:'11;DROP TABLE'},
      {state:'ACTIVE'},{workOrderId:11},
    ];
    for(const bad of changes)
      expect((await storeNv07VerifiedCanaryReceipt(f.db,{...good(),...bad})).accepted).toBe(false);
    const cb=bindNv07CoreReceiptCallback(f.db,{jobId,sourceSha,resourceId});
    expect((await cb({...good(),jobId:'OTHER-JOB'})).accepted).toBe(false);
    expect((await cb({...good(),sourceSha:'c'.repeat(40)})).accepted).toBe(false);
    const unpinned=bindNv07CoreReceiptCallback(f.db,{jobId,sourceSha});
    expect((await unpinned(good())).accepted).toBe(false);
    expect(f.queries).toHaveLength(0);
  });
  it('fails closed when reservation missing or lease expired',async()=>{
    const f=fixture();f.noReservation();
    expect((await storeNv07VerifiedCanaryReceipt(f.db,good())).accepted).toBe(false);
    const g=fixture();g.expire();
    expect((await storeNv07VerifiedCanaryReceipt(g.db,good())).accepted).toBe(false);
    expect(g.records.size).toBe(0);
  });
});