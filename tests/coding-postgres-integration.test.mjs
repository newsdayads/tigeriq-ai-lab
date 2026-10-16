// Run only against a disposable localhost PostgreSQL database whose name includes
// "tigeriq_test". Does not touch PC01, Production, or a shared TigerIQ runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {withAtomicCodingSourceClaim} from '../apps/tigeriq-coding-lane/atomic-source-claim.mjs';
import {repeatedCodingAttemptDecision,codingUnverifiedLegacyHistoryDecision,codingMaterialSourceRevision} from '../apps/tigeriq-coding-lane/step-contract.mjs';

const url=process.env.TIGERIQ_TEST_POSTGRES_URL;
if(!url)throw Error('ISOLATED_POSTGRES_URL_REQUIRED');
const target=new URL(url);
if(target.protocol!=='postgres:'&&target.protocol!=='postgresql:')throw Error('ISOLATED_POSTGRES_SCHEME_INVALID');
const databaseName=decodeURIComponent(target.pathname.startsWith('/')?target.pathname.slice(1):target.pathname);
if(!['127.0.0.1','localhost','::1','[::1]'].includes(target.hostname)||
   !/^tigeriq_test(?:_|$)/i.test(databaseName))
  throw Error('ISOLATED_POSTGRES_LOCAL_TEST_DB_REQUIRED');

test('real isolated PostgreSQL: writers, replay, crash recovery, rollback',async t=>{
  const schema='tigeriq_p0_'+randomBytes(7).toString('hex');
  const admin=new pg.Pool({connectionString:url,max:2,connectionTimeoutMillis:4000});
  let pool,created=false;
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    pool=new pg.Pool({connectionString:url,max:10,connectionTimeoutMillis:4000,
      options:`-c search_path=${schema},public -c statement_timeout=8000`});
    await pool.query(`CREATE TABLE tigeriq_coding_jobs(
      id text PRIMARY KEY,paths jsonb NOT NULL,status text NOT NULL,
      work_order_id text,step_id text,source_revision text,failure_signature text,
      created_at timestamptz NOT NULL DEFAULT now())`);
    const attempt=(id,workOrderId,paths,{status='queued',fail=false,stepId='D01',sourceRevision='rev1',failureSignature=null}={})=>
      withAtomicCodingSourceClaim(pool,{workOrderId,paths,run:async client=>{
        if(fail)throw Error('SIMULATED_CRASH');
        await client.query('INSERT INTO tigeriq_coding_jobs(id,paths,status,work_order_id,step_id,source_revision,failure_signature) VALUES($1,$2::jsonb,$3,$4,$5,$6,$7)',
          [id,JSON.stringify(paths),status,workOrderId,stepId,sourceRevision,failureSignature]);
      }});
    await t.test('parallel same-file writers: exactly one durable insert',async()=>{
      const settled=await Promise.allSettled([
        attempt('t1','4902',['apps/a/one.mjs']),
        attempt('t2','4625',['apps/a/one.mjs'])
      ]);
      assert.deepEqual(settled.map(x=>x.status).sort(),['fulfilled','rejected']);
      assert.match(String(settled.find(x=>x.status==='rejected').reason),/CODING_MUTATION_PATH_ALREADY_IN_FLIGHT/);
      assert.equal(Number((await pool.query('SELECT count(*)::int n FROM tigeriq_coding_jobs')).rows[0].n),1);
      await pool.query('DELETE FROM tigeriq_coding_jobs');
    });
    await t.test('nested directory and file scopes cannot overlap',async()=>{
      const settled=await Promise.allSettled([
        attempt('p1','4902',['apps/a']),
        attempt('p2','4870',['apps/a/one.mjs'])
      ]);
      assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(settled.filter(x=>x.status==='rejected').length,1);
      await pool.query('DELETE FROM tigeriq_coding_jobs');
    });
    await t.test('nonoverlapping source scopes remain eligible',async()=>{
      await Promise.all([
        attempt('s1','4902',['apps/a/one.mjs']),
        attempt('s2','4625',['apps/b/two.mjs'])
      ]);
      assert.equal(Number((await pool.query('SELECT count(*)::int n FROM tigeriq_coding_jobs')).rows[0].n),2);
      await pool.query('DELETE FROM tigeriq_coding_jobs');
    });
    await t.test('transaction failure rolls back, allowing a clean recovery',async()=>{
      await assert.rejects(attempt('fail','4902',['apps/a/one.mjs'],{fail:true}),/SIMULATED_CRASH/);
      assert.equal(Number((await pool.query('SELECT count(*)::int n FROM tigeriq_coding_jobs')).rows[0].n),0);
      await attempt('recovered','4902',['apps/a/one.mjs']);
      await pool.query('DELETE FROM tigeriq_coding_jobs');
    });
    await t.test('uncommitted legacy writer is fenced before canary INSERT',async()=>{
      const legacy=await pool.connect();
      try{
        await legacy.query('BEGIN');
        await legacy.query('INSERT INTO tigeriq_coding_jobs(id,paths,status) VALUES($1,$2::jsonb,$3)',
          ['legacy-inflight',JSON.stringify(['apps/a/one.mjs']),'running']);
        const canary=attempt('canary','4902',['apps/a/one.mjs']);
        // The test must not rely on polling or a fixed sleep; COMMIT releases
        // the table lock after the legacy row becomes visible to the canary.
        await legacy.query('COMMIT');
        await assert.rejects(canary,/CODING_MUTATION_PATH_ALREADY_IN_FLIGHT/);
      }finally{
        try{await legacy.query('ROLLBACK')}catch{}
        legacy.release();
      }
      await pool.query('DELETE FROM tigeriq_coding_jobs');
    });
    await t.test('replayed failure with renamed step is refused in same transaction',async()=>{
      await attempt('failed1','4902',['apps/a/one.mjs'],{status:'failed',failureSignature:'OUTPUT_CONTRACT_EXHAUSTED'});
      await attempt('failed2','4902',['apps/a/one.mjs'],{status:'failed',failureSignature:'OUTPUT_CONTRACT_EXHAUSTED'});
      await assert.rejects(withAtomicCodingSourceClaim(pool,{workOrderId:'4902',paths:['apps/a/one.mjs'],run:async client=>{
        const rows=(await client.query('select work_order_id,step_id,source_revision,status,failure_signature from tigeriq_coding_jobs')).rows;
        const decision=repeatedCodingAttemptDecision({workOrderId:'4902',stepId:'D02',sourceRevision:'rev1',
          failureSignature:'OUTPUT_CONTRACT_EXHAUSTED',
          history:rows.map(x=>({workOrderId:x.work_order_id,stepId:x.step_id,sourceRevision:x.source_revision,status:x.status,failureSignature:x.failure_signature}))});
        if(!decision.allow)throw Error(decision.code);
        await client.query("insert into tigeriq_coding_jobs(id,paths,status) values('replayed','[]'::jsonb,'queued')");
      }}),/CODING_STEP_ALIAS_REPLAY_BLOCKED/);
      assert.equal(Number((await pool.query('SELECT count(*)::int n FROM tigeriq_coding_jobs')).rows[0].n),2);
    });
    await t.test('two workers with the SAME Work Order cannot commit duplicate jobs',async()=>{
      await pool.query('DELETE FROM tigeriq_coding_jobs');
      const attempts=await Promise.allSettled([
        attempt('same-wo-a','4625',['apps/x/source.mjs']),
        attempt('same-wo-b','4625',['apps/x/source.mjs'],{stepId:'D02'})
      ]);
      assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM tigeriq_coding_jobs')).rows[0].n,1);
      await pool.query('DELETE FROM tigeriq_coding_jobs');
    });
    await t.test('database connection crash rolls back uncommitted job and releases PostgreSQL locks',async()=>{
      const broken=await pool.connect();
      try{
        await broken.query('BEGIN');
        await broken.query('INSERT INTO tigeriq_coding_jobs(id,paths,status) VALUES($1,$2::jsonb,$3)',
          ['crashed-uncommitted',JSON.stringify(['apps/crash/file.mjs']),'running']);
      }finally{broken.release(true)}
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM tigeriq_coding_jobs WHERE id='crashed-uncommitted'")).rows[0].n,0);
      await attempt('resumed-after-crash','4625',['apps/crash/file.mjs']);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM tigeriq_coding_jobs WHERE id='resumed-after-crash'")).rows[0].n,1);
      await pool.query('DELETE FROM tigeriq_coding_jobs');
    });
    await t.test('same-failure retry 1/2 and retry 2/2 share DB history and reject third',async()=>{
      const workOrderId='4625',scope=['apps/retry/api.mjs'];
      const insertWithHistory=(id,stepId)=>withAtomicCodingSourceClaim(pool,{workOrderId,paths:scope,run:async client=>{
        const rows=(await client.query('SELECT work_order_id,step_id,source_revision,status,failure_signature FROM tigeriq_coding_jobs')).rows;
        const decision=repeatedCodingAttemptDecision({
          workOrderId,stepId,sourceRevision:'source-abc',
          failureSignature:'OUTPUT_CONTRACT_EXHAUSTED',
          history:rows.map(x=>({workOrderId:x.work_order_id,stepId:x.step_id,sourceRevision:x.source_revision,
            status:x.status,failureSignature:x.failure_signature}))
        });
        if(!decision.allow)throw Error(decision.code);
        await client.query('INSERT INTO tigeriq_coding_jobs(id,paths,status,work_order_id,step_id,source_revision,failure_signature) VALUES($1,$2::jsonb,$3,$4,$5,$6,$7)',
          [id,JSON.stringify(scope),'failed',workOrderId,stepId,'source-abc','OUTPUT_CONTRACT_EXHAUSTED']);
      }});
      await insertWithHistory('retry1','D01');
      await insertWithHistory('retry2','D01');
      await assert.rejects(insertWithHistory('retry3','D01'),/CODING_SAME_FAILURE_STOP/);
      await assert.rejects(insertWithHistory('renamed_step','D02'),/CODING_STEP_ALIAS_REPLAY_BLOCKED/);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM tigeriq_coding_jobs WHERE work_order_id='4625'")).rows[0].n,2);
      const p=['apps/retry/api.mjs'],blobs={ [p[0]]:null };
      const x=codingMaterialSourceRevision({canonicalWorkOrderId:workOrderId,paths:p,sourceBlobs:blobs});
      const y=codingMaterialSourceRevision({canonicalWorkOrderId:workOrderId,paths:p,sourceBlobs:blobs,
        objective:'Renamed retry 2/2 for issue #4625'});
      assert.equal(x,y);
      await pool.query('DELETE FROM tigeriq_coding_jobs');
    });
    await t.test('legacy failed job is not silently upgraded into clean G4 history',async()=>{
      await attempt('legacy-row','4870',['apps/legacy/source.mjs'],{status:'failed'});
      await assert.rejects(withAtomicCodingSourceClaim(pool,{
        workOrderId:'4870',paths:['apps/legacy/source.mjs'],
        run:async client=>{
          const rows=(await client.query('SELECT work_order_id,status FROM tigeriq_coding_jobs')).rows;
          const decision=codingUnverifiedLegacyHistoryDecision({
            workOrderId:'4870',legacyRows:rows.map(x=>({workOrderId:x.work_order_id,status:x.status}))
          });
          if(!decision.allow)throw Error(decision.code);
          await client.query("INSERT INTO tigeriq_coding_jobs(id,paths,status) VALUES('duplicate','[]'::jsonb,'queued')");
        }
      }),/CODING_PRE_CANARY_HISTORY_UNVERIFIED/);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM tigeriq_coding_jobs')).rows[0].n,1);
      await pool.query('DELETE FROM tigeriq_coding_jobs');
    });
  }finally{
    if(pool)await pool.end();
    if(created)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
