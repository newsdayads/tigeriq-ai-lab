import test from 'node:test';
import assert from 'node:assert/strict';
import {withAtomicCodingSourceClaim} from '../apps/tigeriq-coding-lane/atomic-source-claim.mjs';

function db({active=[],failInsert=false}={}){
  const statements=[];let released=false;
  const client={
    query:async(sql,args=[])=>{
      statements.push({sql,args});
      if(sql.startsWith('select id,paths from tigeriq_coding_jobs'))return {rows:active};
      if(failInsert&&sql.startsWith('insert into tigeriq_coding_jobs'))throw Error('SIMULATED_DB_CONFLICT');
      return {rows:[]};
    },
    release:()=>{released=true}
  };
  return {pool:{connect:async()=>client},statements,client,get released(){return released}};
}
test('canonical work order and scoped file lock are acquired before query+insert+commit',async()=>{
  const t=db(),paths=['apps/a/b.mjs','apps/a/c.mjs'];
  await withAtomicCodingSourceClaim(t.pool,{workOrderId:'4625',paths:paths.slice().reverse(),run:async client=>{
    await client.query('insert into tigeriq_coding_jobs(id) values($1)',['JOB-1']);
    return 'inserted';
  }});
  const sql=t.statements.map(x=>x.sql);
  assert.equal(sql[0],'BEGIN');
  assert.equal(sql[1],'select pg_advisory_xact_lock(hashtextextended($1,0))');
  assert.equal(sql.filter(x=>x.startsWith('select pg_advisory_xact_lock')).length,5);
  const tableLock=sql.indexOf('LOCK TABLE tigeriq_coding_jobs IN SHARE ROW EXCLUSIVE MODE');
  const writerScan=sql.findIndex(x=>x.startsWith('select id,paths from tigeriq_coding_jobs'));
  assert.ok(tableLock>0&&tableLock<writerScan);
  assert.ok(sql.indexOf('insert into tigeriq_coding_jobs(id) values($1)')>writerScan);
  assert.equal(sql.at(-1),'COMMIT');
  assert.equal(t.released,true);
  assert.deepEqual(t.statements.slice(1,6).map(x=>[x.sql,x.args[0]]),[
    ['select pg_advisory_xact_lock(hashtextextended($1,0))','coding-work-order:4625'],
    ['select pg_advisory_xact_lock_shared(hashtextextended($1,0))','coding-file:apps'],
    ['select pg_advisory_xact_lock_shared(hashtextextended($1,0))','coding-file:apps/a'],
    ['select pg_advisory_xact_lock(hashtextextended($1,0))','coding-file:apps/a/b.mjs'],
    ['select pg_advisory_xact_lock(hashtextextended($1,0))','coding-file:apps/a/c.mjs']
  ]);
});
test('an in-flight file writer cannot trigger a second insert, and xact rolls back',async()=>{
  const t=db({active:[{id:'CODE-existing',paths:['apps/a/b.mjs']}]});
  await assert.rejects(withAtomicCodingSourceClaim(t.pool,{workOrderId:'new-objective',paths:['apps/a/b.mjs'],run:async()=>{
    throw Error('MUST_NOT_RUN');
  }}),/CODING_MUTATION_PATH_ALREADY_IN_FLIGHT/);
  const sql=t.statements.map(x=>x.sql);
  assert.ok(sql.includes('ROLLBACK'));
  assert.ok(!sql.some(x=>x.startsWith('insert into')));
  assert.equal(t.released,true);
});
test('DB insert failure rolls back without partial claimed job',async()=>{
  const t=db({failInsert:true});
  await assert.rejects(withAtomicCodingSourceClaim(t.pool,{workOrderId:'4625',paths:['apps/a/b.mjs'],run:async client=>{
    await client.query('insert into tigeriq_coding_jobs(id) values($1)',['JOB-2']);
  }}),/SIMULATED_DB_CONFLICT/);
  assert.equal(t.statements.at(-1).sql,'ROLLBACK');
  assert.equal(t.released,true);
});

test('legacy directory scope overlaps nested file, no second writer may start',async()=>{
  const t=db({active:[{id:'legacy-dir',paths:['apps/module']}]});
  await assert.rejects(withAtomicCodingSourceClaim(t.pool,{
    workOrderId:'new',paths:['apps/module/handler.mjs'],run:async()=>{throw Error('MUST_NOT_RUN')}
  }),/CODING_MUTATION_PATH_ALREADY_IN_FLIGHT/);
  assert.equal(t.statements.at(-1).sql,'ROLLBACK');
});
test('unrelated project files remain independently eligible',async()=>{
  const t=db({active:[{id:'other',paths:['apps/another/file.mjs']}]});
  let wrote=false;
  await withAtomicCodingSourceClaim(t.pool,{workOrderId:'new',paths:['apps/module/handler.mjs'],run:async()=>{wrote=true}});
  assert.equal(wrote,true);
  assert.equal(t.statements.at(-1).sql,'COMMIT');
});
test('malformed or oversized live-writer evidence fails closed',async()=>{
  const unknown=db({active:[{id:'unknown',paths:null}]});
  await assert.rejects(withAtomicCodingSourceClaim(unknown.pool,{workOrderId:'a',paths:['apps/a/file.mjs'],run:async()=>null}),/CODING_ACTIVE_WRITER_PATHS_UNVERIFIED/);
  const huge=db({active:Array.from({length:2001},(_,n)=>({id:String(n),paths:['apps/other/'+n]}))});
  await assert.rejects(withAtomicCodingSourceClaim(huge.pool,{workOrderId:'a',paths:['apps/a/file.mjs'],run:async()=>null}),/CODING_ACTIVE_WRITER_SCAN_INCOMPLETE/);
});

test('root-level source writer conflicts with nested scope, siblings share only ancestors',async()=>{
  const root=db(),child=db(),other=db();
  await withAtomicCodingSourceClaim(root.pool,{workOrderId:'root',paths:['apps'],run:async()=>true});
  await withAtomicCodingSourceClaim(child.pool,{workOrderId:'child',paths:['apps/module/file.mjs'],run:async()=>true});
  await withAtomicCodingSourceClaim(other.pool,{workOrderId:'other',paths:['other/file.mjs'],run:async()=>true});
  const modes=(t,path)=>t.statements.filter(x=>x.args?.[0]==='coding-file:'+path).map(x=>x.sql);
  assert.deepEqual(modes(root,'apps'),['select pg_advisory_xact_lock(hashtextextended($1,0))']);
  assert.deepEqual(modes(child,'apps'),['select pg_advisory_xact_lock_shared(hashtextextended($1,0))']);
  assert.deepEqual(modes(child,'apps/module'),['select pg_advisory_xact_lock_shared(hashtextextended($1,0))']);
  assert.deepEqual(modes(child,'apps/module/file.mjs'),['select pg_advisory_xact_lock(hashtextextended($1,0))']);
  assert.deepEqual(modes(other,'apps'),[]);
});
test('non-canonical source path segments fail before any DB transaction',async()=>{
  for(const path of ['apps//file.mjs','apps/./file.mjs','apps/file.mjs/','/apps/file.mjs']){
    const t=db();
    await assert.rejects(withAtomicCodingSourceClaim(t.pool,{workOrderId:'scope',paths:[path],run:async()=>true}),/CODING_ATOMIC_CLAIM_SCOPE_INVALID/);
    assert.equal(t.statements.length,0);
  }
});

test('legacy INSERTs must serialize with atomic source claim across DB sessions',async()=>{
  const t=db();
  await withAtomicCodingSourceClaim(t.pool,{workOrderId:'4625',paths:['apps/a/file.mjs'],run:async()=>true});
  const steps=t.statements.map(x=>x.sql);
  assert.ok(steps.indexOf('LOCK TABLE tigeriq_coding_jobs IN SHARE ROW EXCLUSIVE MODE')<steps.findIndex(x=>x.startsWith('select id,paths from tigeriq_coding_jobs')));
  assert.ok(steps.includes('COMMIT'));
});
