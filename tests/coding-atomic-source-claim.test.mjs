import test from 'node:test';
import assert from 'node:assert/strict';
import {withAtomicCodingSourceClaim} from '../apps/tigeriq-coding-lane/atomic-source-claim.mjs';

function db({active=[],failInsert=false}={}){
  const statements=[];let released=false;
  const client={
    query:async(sql,args=[])=>{
      statements.push({sql,args});
      if(sql.startsWith('select id from tigeriq_coding_jobs'))return {rows:active};
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
  assert.equal(sql.filter(x=>x.startsWith('select pg_advisory_xact_lock')).length,3);
  assert.ok(sql.indexOf('insert into tigeriq_coding_jobs(id) values($1)')>sql.findIndex(x=>x.startsWith('select id from tigeriq_coding_jobs')));
  assert.equal(sql.at(-1),'COMMIT');
  assert.equal(t.released,true);
  assert.deepEqual(t.statements[2].args,['coding-file:apps/a/b.mjs']);
  assert.deepEqual(t.statements[3].args,['coding-file:apps/a/c.mjs']);
});
test('an in-flight file writer cannot trigger a second insert, and xact rolls back',async()=>{
  const t=db({active:[{id:'CODE-existing'}]});
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
