import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScopeLease,claimGithubScopeLease,readGithubScopeLease,
  renewGithubScopeLease,releaseGithubScopeLease,ensureGithubScopeLeases,
} from './github-scope-lease.mjs';

const BASE={resourceScope:'NV03_GITHUB_CLAIM_ACCEPTANCE_20261010',issueNumber:4653,workerSessionId:'NV03-session-20261011',workerId:'NV03'};
class FakePg{
  constructor(){this.rows=new Map();this.core=new Set();this.queues=new Map();this.calls=[];}
  async query(sql,args=[]){return this.respond(sql,args);}
  async connect(){
    const db=this;let releaseLock=null;
    return {
      async query(sql,args=[]){
        db.calls.push(sql);
        if(sql==='begin')return {rowCount:0};
        if(sql.startsWith('select pg_advisory_xact_lock')){
          const key=args[0],prev=db.queues.get(key)||Promise.resolve();let unlock;
          const current=new Promise(r=>{unlock=r});
          db.queues.set(key,prev.then(()=>current));
          await prev;releaseLock=unlock;return {rowCount:1};
        }
        if(sql==='commit'||sql==='rollback'){releaseLock?.();releaseLock=null;return {rowCount:0};}
        return db.respond(sql,args);
      },
      release(){releaseLock?.();}
    };
  }
  async respond(sql,args){
    this.calls.push(sql);
    if(sql.startsWith('create table'))return {rowCount:0};
    if(sql.startsWith('select id from tigeriq_objectives'))
      return {rowCount:this.core.has(args[0])?1:0,rows:this.core.has(args[0])?[{id:'OBJ'}]:[]};
    if(sql.startsWith('insert into tigeriq_github_scope_leases')){
      const [scope,id,worker,session,issue,ttl]=args,old=this.rows.get(scope);
      if(old&&old.until>Date.now())return {rowCount:0,rows:[]};
      const row={resource_scope:scope,lease_id:id,worker_id:worker,worker_session_id:session,issue_number:issue,lease_until:new Date(Date.now()+ttl).toISOString(),until:Date.now()+ttl};
      this.rows.set(scope,row);return {rowCount:1,rows:[row]};
    }
    if(sql.startsWith('select resource_scope,lease_id,worker_id')){
      const row=this.rows.get(args[0]);
      return {rowCount:row&&row.until>Date.now()?1:0,rows:row&&row.until>Date.now()?[row]:[]};
    }
    if(sql.startsWith('update tigeriq_github_scope_leases')){
      const [scope,id,worker,session,ttl]=args,row=this.rows.get(scope);
      if(!row||row.lease_id!==id||row.worker_id!==worker||row.worker_session_id!==session||row.until<=Date.now())return {rowCount:0,rows:[]};
      row.until=Date.now()+ttl;row.lease_until=new Date(row.until).toISOString();
      return {rowCount:1,rows:[row]};
    }
    if(sql.startsWith('delete from tigeriq_github_scope_leases')){
      const [scope,id,worker,session]=args,row=this.rows.get(scope);
      if(!row||row.lease_id!==id||row.worker_id!==worker||row.worker_session_id!==session)return {rowCount:0,rows:[]};
      this.rows.delete(scope);return {rowCount:1,rows:[{resource_scope:scope}]};
    }
    if(sql.startsWith('select 1 from tigeriq_github_scope_leases')){
      const row=this.rows.get(args[0]);return {rowCount:row&&row.until>Date.now()?1:0,rows:row&&row.until>Date.now()?[{one:1}]:[]};
    }
    throw Error('UNEXPECTED_SQL:'+sql.slice(0,120));
  }
}
test('fail closed on invalid worker, session, scope, issue and TTL',()=>{
  for(const patch of [
    {workerId:'UNKNOWN'},{workerSessionId:'NV03'},{resourceScope:'x'},{issueNumber:0},{ttlMs:10},{ttlMs:700000},
  ])assert.throws(()=>validateScopeLease({...BASE,...patch}));
});
test('the migration declares a unique global resource scope',async()=>{
  const db=new FakePg();await ensureGithubScopeLeases(db);
  assert.match(db.calls[0],/resource_scope text primary key/);
  assert.match(db.calls[0],/lease_id uuid not null unique/);
});
test('NV02/NV03/Core concurrent claims have exactly one winner',async()=>{
  const db=new FakePg();
  const tries=Array.from({length:24},(_,i)=>claimGithubScopeLease(db,{
    ...BASE,workerId:i%3===0?'NV02':i%3===1?'NV03':'CORE',workerSessionId:'session-worker-'+i,
  }));
  const results=await Promise.all(tries);
  assert.equal(results.filter(x=>x.acquired).length,1);
  assert.equal(results.filter(x=>x.reason==='SCOPE_HELD').length,23);
  const holder=await readGithubScopeLease(db,BASE.resourceScope);
  assert.equal(holder.lease_id,results.find(x=>x.acquired).lease.lease_id);
  assert.match(db.calls.join('\n'),/pg_advisory_xact_lock/);
});
test('wrong identity cannot renew/release; winner can release and next worker can claim',async()=>{
  const db=new FakePg();const a=await claimGithubScopeLease(db,BASE);assert.equal(a.acquired,true);
  const holder={...BASE,leaseId:a.lease.lease_id};
  assert.equal(await renewGithubScopeLease(db,{...holder,workerSessionId:'other-session-999'}),null);
  assert.equal(await releaseGithubScopeLease(db,{...holder,workerId:'NV02'}),false);
  assert.ok(await renewGithubScopeLease(db,holder));
  assert.equal(await releaseGithubScopeLease(db,holder),true);
  assert.equal(await readGithubScopeLease(db,BASE.resourceScope),null);
  assert.equal((await claimGithubScopeLease(db,{...BASE,workerId:'NV02',workerSessionId:'NV02-session-20261011'})).acquired,true);
});
test('active Core objective blocks external claim even without a visible GitHub lease',async()=>{
  const db=new FakePg();db.core.add(BASE.resourceScope);
  assert.deepEqual(await claimGithubScopeLease(db,BASE),{acquired:false,reason:'CORE_SCOPE_ACTIVE'});
  assert.equal(db.rows.size,0);
});
test('expired lease can be replaced, but cannot be renewed by its previous owner',async()=>{
  const db=new FakePg();const first=await claimGithubScopeLease(db,BASE);
  db.rows.get(BASE.resourceScope).until=Date.now()-1000;
  const second=await claimGithubScopeLease(db,{...BASE,workerId:'NV02',workerSessionId:'NV02-session-20261011'});
  assert.equal(second.acquired,true);assert.notEqual(first.lease.lease_id,second.lease.lease_id);
  assert.equal(await renewGithubScopeLease(db,{...BASE,leaseId:first.lease.lease_id}),null);
});
