import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {Pool} from 'pg';

test('Core boots against PostgreSQL, quarantines legacy work and never replays it after restart', {timeout:60000}, async()=>{
  assert.ok(process.env.TEST_DATABASE_URL,'TEST_DATABASE_URL must point to disposable CI PostgreSQL');
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  let child; let logs='';
  const start=async()=>{
    logs='';
    child=spawn(process.execPath,['apps/tigeriq-core/core-entry.mjs'],{
      env:{PATH:process.env.PATH,DATABASE_URL:process.env.TEST_DATABASE_URL,TIGERIQ_CORE_HOST:'127.0.0.1',TIGERIQ_CORE_PORT:'18955',TIGERIQ_CORE_POLL_MS:'100'},
      stdio:['ignore','pipe','pipe']
    });
    child.stdout.on('data',x=>logs+=x);
    child.stderr.on('data',x=>logs+=x);
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw new Error('Core exited: '+logs);
      try{const r=await fetch('http://127.0.0.1:18955/health');if(r.ok)return;}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    throw new Error('Core health timeout: '+logs);
  };
  const stop=async()=>{
    if(child&&child.exitCode===null){const closed=once(child,'close');child.kill('SIGTERM');await closed;}
  };
  try{
    await start();await stop();
    await pool.query("delete from tigeriq_migrations where id='step1-legacy-quarantine'");
    await pool.query(`create table tigeriq_coding_objectives(id text primary key,status text,objective text);
      create table tigeriq_coding_jobs(id text primary key,status text,attempts int,result jsonb);
      insert into tigeriq_coding_objectives values('old-objective','active','preserve instruction');
      insert into tigeriq_coding_jobs values('old-job','waiting_resource',2,'{"evidence":"keep"}');
      insert into tigeriq_coding_jobs values('done-job','done',1,'{"evidence":"done"}');
      insert into tigeriq_objectives(id,objective) values('core-old','preserve objective');
      insert into tigeriq_jobs(id,objective_id,title,prompt,status,attempts)
        values('core-old-job','core-old','legacy','never execute','queued',1)`);
    const before=(await pool.query("select to_jsonb(t) as row from tigeriq_coding_jobs t where id='old-job'")).rows[0].row;
    await start();
    const status=await (await fetch('http://127.0.0.1:18955/api/status')).json();
    assert.equal(status.ok,true);
    assert.equal(status.automation.enabled,false);
    assert.ok(status.jobs.some(j=>j.id==='core-old-job'&&j.status==='blocked'));
    const post=await fetch('http://127.0.0.1:18955/api/objectives',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective:'must not enqueue'})});
    assert.equal(post.status,409);
    await new Promise(r=>setTimeout(r,1500));
    await stop();
    await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,status,attempts) values('new-research','core-old','explicit research','research','failed',1)");
    await start();await stop();
    assert.equal((await pool.query("select status from tigeriq_jobs where id='new-research'")).rows[0].status,'failed');
    const archived=(await pool.query("select original_row from tigeriq_legacy_quarantine where source_table='tigeriq_coding_jobs' and source_id='old-job'")).rows;
    assert.deepEqual(archived,[{original_row:before}]);
    assert.deepEqual((await pool.query("select status,attempts,result from tigeriq_coding_jobs where id='old-job'")).rows,[{status:'blocked',attempts:2,result:{evidence:'keep'}}]);
    assert.equal((await pool.query("select status from tigeriq_coding_jobs where id='done-job'")).rows[0].status,'done');
    assert.equal((await pool.query("select count(*)::int n from tigeriq_jobs")).rows[0].n,2);
    assert.equal((await pool.query("select manager_cycles from tigeriq_objectives where id='core-old'")).rows[0].manager_cycles,0);
    assert.equal((await pool.query("select count(*)::int n from tigeriq_events where type in ('SELF_CHECK_LIGHT','SELF_CHECK_DEEP','JOB_CREATED','JOB_DONE','MANAGER_ERROR')")).rows[0].n,0);
  }finally{await stop();await pool.end();}
});
test('Core still fails closed without its required database configuration',()=>{
  const run=spawnSync(process.execPath,['apps/tigeriq-core/core.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:5000});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/DATABASE_URL_MISSING/);
});
