// Real OS subprocess, real PostgreSQL transport. No production worker impersonation.
import {Pool} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {acquireSharedResourceLease,releaseSharedResourceLease} from '../../apps/tigeriq-core/shared-resource-lease.mjs';
import {withAtomicCodingSourceClaim} from '../../apps/tigeriq-coding-lane/atomic-source-claim.mjs';
import {repeatedCodingAttemptDecision} from '../../apps/tigeriq-coding-lane/step-contract.mjs';

if(!process.send||!/^g6_work_[a-f0-9]+$/.test(process.env.PGDATABASE||'')||
   !String(process.env.PGHOST||'').startsWith('/tmp/tigeriq-g6-work-'))throw Error('G6_WORKER_SCOPE_DENIED');
const pool=new Pool({max:2});
pool.on('error',e=>process.send?.({event:'db_error',code:e.code}));
const workerId=randomUUID();
const emit=data=>process.send({worker_id:workerId,pid:process.pid,...data});
const hash=x=>createHash('sha256').update(x).digest('hex');
process.on('message',async m=>{
  try{
    if(m.action==='lease'){
      const lease=await acquireSharedResourceLease(pool,{employeeId:'NV01',resourceId:'g6-shared',workId:m.work,role:'implementer',metadata:{workerId,source:process.env.G6_SOURCE_SHA}});
      emit({event:'lease',lease});
    }else if(m.action==='claim'){
      const id=await withAtomicCodingSourceClaim(pool,{workOrderId:'G6-4902',paths:['sandbox/candidate.mjs'],run:async c=>{
        const id=randomUUID();await c.query("insert into tigeriq_coding_jobs(id,paths,status) values($1,$2,'running')",[id,['sandbox/candidate.mjs']]);return id;
      }});emit({event:'claim',id});
    }else if(m.action==='release'){
      emit({event:'release',released:await releaseSharedResourceLease(pool,{resourceId:'g6-shared',leaseToken:m.token})});
    }else if(m.action==='transaction'){
      const c=await pool.connect();
      c.on('error',e=>emit({event:'connection_lost',code:e.code}));
      await c.query('begin');
      await c.query("insert into g6_effects(id,value) values($1,'uncommitted')",[m.id]);
      const pid=(await c.query('select pg_backend_pid() as pid')).rows[0].pid;
      emit({event:'transaction_open',backend_pid:pid});
      // Parent deliberately terminates this connection or SIGKILLs the process.
    }else if(m.action==='retry'){
      const c=await pool.connect();
      try{
        await c.query('begin');
        const r=(await c.query('select history from g6_retry where id=1 for update')).rows[0];
        const history=r.history;
        const decision=repeatedCodingAttemptDecision({workOrderId:'4902',stepId:'G6',sourceRevision:process.env.G6_SOURCE_SHA,failureSignature:'G6_INJECTED_FAILURE',history});
        if(decision.allow){
          history.push({workOrderId:'4902',stepId:'G6',sourceRevision:process.env.G6_SOURCE_SHA,failureSignature:'G6_INJECTED_FAILURE',status:'failed'});
          await c.query('update g6_retry set history=$1::jsonb where id=1',[JSON.stringify(history)]);
        }
        await c.query('commit');emit({event:'retry',decision,attempts:history.length});
      }catch(e){await c.query('rollback');throw e;}finally{c.release();}
    }else if(m.action==='model'){
      if(!['manager','implementer','reviewer','acceptor'].includes(m.role))throw Error('G6_MODEL_ROLE_DENIED');
      const employeeId={manager:'NV02',implementer:'NV03',reviewer:'NV04',acceptor:'NV05'}[m.role];
      const resourceId='g6-role-'+m.role;
      const lease=await acquireSharedResourceLease(pool,{employeeId,resourceId,workId:'g6-model-'+workerId,role:m.role,ttlMs:600000,metadata:{workerId,source:process.env.G6_SOURCE_SHA}});
      if(!lease)throw Error('G6_MODEL_LEASE_UNAVAILABLE');
      try{
      const start=Date.now();
      const r=await fetch('http://127.0.0.1:11435/api/generate',{
        method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(420000),
        body:JSON.stringify({model:'qwen2.5-coder:7b',prompt:m.prompt,stream:false,keep_alive:'0s',
          format:m.schema,options:{temperature:0,num_ctx:8192,num_predict:600}})
      });
      if(!r.ok)throw Error('G6_MODEL_HTTP_'+r.status);
      const data=await r.json();
      if(data.done!==true||data.model!=='qwen2.5-coder:7b')throw Error('G6_MODEL_RESPONSE_UNVERIFIED');
      const parsed=JSON.parse(data.response);
      emit({event:'model',role:m.role,model_id:data.model,prompt:m.prompt,prompt_sha256:hash(m.prompt),
        response:data.response,response_sha256:hash(data.response),parsed,elapsed_ms:Date.now()-start,eval_count:data.eval_count,lease});
      }finally{await releaseSharedResourceLease(pool,{resourceId,leaseToken:lease.lease_token});}
    }else if(m.action==='stop'){
      await pool.end();process.disconnect();
    }else throw Error('G6_ACTION_DENIED');
  }catch(e){emit({event:'error',code:e.code||e.message,message:e.message});}
});
emit({event:'ready'});
