// G6 Work: imported production components + real subprocess/PG/local-model sandbox.
// Does NOT start production Core/Coding Lane or mark their dispatch accepted.
import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {ensureSharedResourceLeaseTable,recoverExpiredSharedResourceLeases,heartbeatSharedResourceLease} from '../../apps/tigeriq-core/shared-resource-lease.mjs';
import {compileCodingStepPacket,codingRolePrompt,verifyCodingDeliverable,repeatedCodingAttemptDecision,verifyCodingCanaryProductGate} from '../../apps/tigeriq-coding-lane/step-contract.mjs';
import {loadRequiredCodingSkills} from '../../apps/tigeriq-coding-lane/coding-skill-policy.mjs';
import {evaluateProductAcceptance} from '../../apps/tigeriq-coding-lane/product-acceptance.mjs';
import {sha256,verifySandboxReceipt} from './receipt-policy.mjs';

const source=process.env.GITHUB_SHA||'';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
 process.env.GITHUB_REPOSITORY!=='newsdayads/tigeriq-ai-lab'||process.env.GITHUB_REF!=='refs/heads/p0/4902-g6-work-e2e'||
 process.env.G6_PUBLIC_ZERO_COST!=='true'||!/^[a-f0-9]{40}$/.test(source))throw Error('G6_EXECUTION_SURFACE_DENIED');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source);
// Explicitly scrub remote DB/provider credentials; every child gets an allowlist.
delete process.env.DATABASE_URL;
process.env.NODE_ENV='test';
const {assertIndependentReviewApproval,restartRecoveryDecision,staleRunningRecoveryDecision}=await import('../../apps/tigeriq-coding-lane/coding-lane.mjs');
const out='p0-g6-work-evidence';mkdirSync(out,{recursive:true});
const receipt={source_sha:source,base_sha:'d57ae78f77d720bc7be1fa875b5328a2af700ba7',run_id:process.env.GITHUB_RUN_ID,
 status:'RUNNING',production_runtime_accepted:false,permission:{surface:'GITHUB_BRANCH_ISOLATED_ONLY',new_cost:0,no_pc01_shell:true,
 authority:'Owner explicit P0 #4902 G6 Work isolated E2E instruction',receipt_url:'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/'+process.env.GITHUB_RUN_ID},
 scenarios:[],models:[],workers:[],leases:[],cleanup:{verified:false},open_issues:[]};
const save=()=>writeFileSync(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
const scenario=async(name,run)=>{
 try{const evidence=await run();receipt.scenarios.push({name,status:'PASS',evidence});console.log('G6_SCENARIO_PASS='+name);}
 catch(e){receipt.scenarios.push({name,status:'FAIL',error:e.code||e.message,message:e.message});throw e;}
 finally{save();}
};
const dir=mkdtempSync(join(tmpdir(),'tigeriq-g6-work-')),data=join(dir,'data'),socket=join(dir,'socket');
mkdirSync(socket);chmodSync(dir,0o755);
const username=userInfo().username,db='g6_work_'+randomBytes(6).toString('hex');
const pgBin=execFileSync('bash',['-c','ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1'],{encoding:'utf8'}).trim();
if(!/^\/usr\/lib\/postgresql\/\d+\/bin$/.test(pgBin)||username!=='runner')throw Error('G6_POSTGRES_HOST_UNAVAILABLE');
const pgRun=(name,args)=>execFileSync(join(pgBin,name),args,{encoding:'utf8',timeout:20000});
let pool,started=false;const children=new Set(),containers=new Set();
const env={PATH:process.env.PATH,HOME:dir,NODE_ENV:'test',PGHOST:socket,PGPORT:'15439',PGUSER:username,PGDATABASE:db,G6_SOURCE_SHA:source};
function spawnWorker(){
 const child=fork(new URL('./worker.mjs',import.meta.url),[],{env,stdio:['ignore','inherit','inherit','ipc']});
 children.add(child);const pending=[],messages=[];
 child.on('message',m=>{const waiter=pending.shift();if(waiter)waiter(m);else messages.push(m);});
 child.on('exit',(code,signal)=>{children.delete(child);while(pending.length)pending.shift()({event:'exit',code,signal});});
 const wait=async()=>messages.length?messages.shift():new Promise((resolve,reject)=>{
  const done=m=>{clearTimeout(timer);resolve(m);};
  const timer=setTimeout(()=>{const i=pending.indexOf(done);if(i>=0)pending.splice(i,1);reject(Error('G6_WORKER_TIMEOUT'));},450000);pending.push(done);
 });
 return {child,wait,send:m=>child.send(m),async ask(m){child.send(m);const r=await wait();if(r.event==='error')throw Object.assign(Error(r.message),{code:r.code});return r;}};
}
async function ready(){const w=spawnWorker();const r=await w.wait();assert.equal(r.event,'ready');receipt.workers.push(r);return w;}
async function kill(w){const exited=new Promise(resolve=>w.child.once('exit',resolve));w.child.kill('SIGKILL');await exited;}
async function row(sql,args=[]){return (await pool.query(sql,args)).rows[0];}
try{
 pgRun('initdb',['-D',data,'-A','trust','-U',username,'--no-locale']);
 pgRun('pg_ctl',['-D',data,'-l',join(dir,'postgres.log'),'-o',`-k ${socket} -h '' -p 15439`,'-w','start']);started=true;
 // Private Unix socket only: no externally reachable PostgreSQL listener.
 pool=new Pool({host:socket,port:15439,user:username,database:'postgres'});
 await pool.query('create database '+db);await pool.end();
 pool=new Pool({host:socket,port:15439,user:username,database:db});
 await pool.query(`create table tigeriq_ai_resources(resource_id text primary key,employee_id text,enabled boolean,rank int,current_job_id text,work_state text,health_state text,updated_at timestamptz default now());
 create table tigeriq_resources(employee_id text primary key,current_job_id text,work_state text,health_state text,updated_at timestamptz default now());
 create table tigeriq_coding_jobs(id text primary key,paths text[],status text,created_at timestamptz default now());
 create table tigeriq_jobs(id text primary key,status text);
 create table g6_effects(id text primary key,value text);
 create table g6_retry(id int primary key,history jsonb);
 insert into g6_retry values(1,'[]'::jsonb);
 insert into tigeriq_ai_resources values('g6-shared','NV01',true,1,null,'READY','READY',now());
 insert into tigeriq_resources values('NV01',null,'READY','READY',now());`);
 await ensureSharedResourceLeaseTable(pool);
 for(const [role,employee] of [['manager','NV02'],['implementer','NV03'],['reviewer','NV04'],['acceptor','NV05']]){
  await pool.query("insert into tigeriq_ai_resources values($1,$2,true,1,null,'READY','READY',now())",['g6-role-'+role,employee]);
  await pool.query("insert into tigeriq_resources values($1,null,'READY','READY',now())",[employee]);
 }
 receipt.database={name:db,transport:'private-unix-socket',server_version:(await row('show server_version')).server_version};save();
 let lease,owner;
 await scenario('two_real_workers_one_resource_lease',async()=>{
  const a=await ready(),b=await ready();
  const results=await Promise.all([a.ask({action:'lease',work:'g6-work-a'}),b.ask({action:'lease',work:'g6-work-b'})]);
  assert.equal(results.filter(x=>x.lease).length,1);
  lease=results.find(x=>x.lease).lease;owner=results[0].lease?a:b;
  receipt.leases.push(lease);assert.equal(Number((await row('select count(*) from tigeriq_ai_resource_leases')).count),1);
  return {workers:results.map(x=>x.worker_id),lease_id:lease.lease_token,winners:1};
 });
 await scenario('duplicate_source_dispatch_blocked',async()=>{
  const a=await ready(),b=await ready();
  const results=await Promise.all([a.ask({action:'claim'}).then(x=>({ok:true,...x}),e=>({ok:false,code:e.code})),b.ask({action:'claim'}).then(x=>({ok:true,...x}),e=>({ok:false,code:e.code}))]);
  assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.find(x=>!x.ok).code,'CODING_MUTATION_PATH_ALREADY_IN_FLIGHT');
  assert.equal(Number((await row('select count(*) from tigeriq_coding_jobs')).count),1);return results;
 });
 await scenario('connection_loss_rolls_back_transaction',async()=>{
  const w=await ready(),id=randomUUID();const r=await w.ask({action:'transaction',id});assert.equal(r.event,'transaction_open');
  assert.equal((await row('select pg_terminate_backend($1) as killed',[r.backend_pid])).killed,true);
  const loss=await w.wait();assert.equal(loss.event,'connection_lost');
  assert.equal(Number((await row('select count(*) from g6_effects where id=$1',[id])).count),0);
  await kill(w);return {worker_id:r.worker_id,backend_pid:r.backend_pid,loss,committed_rows:0};
 });
 await scenario('worker_death_restart_takeover_old_token_fenced',async()=>{
  const txId=randomUUID(),open=await owner.ask({action:'transaction',id:txId});
  await kill(owner);
  assert.equal(Number((await row('select count(*) from g6_effects where id=$1',[txId])).count),0);
  const restarted=await ready();assert.equal((await restarted.ask({action:'lease',work:'g6-restart'})).lease,null);
  // Wait the REAL minimum 30s TTL; do not rewrite lease timestamps.
  const expiry=Date.parse(lease.lease_until);await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry-Date.now()+150)));
  const recovered=await recoverExpiredSharedResourceLeases(pool);assert.equal(recovered.length,1);
  const r=await restarted.ask({action:'lease',work:'g6-takeover'});assert.ok(r.lease);assert.notEqual(r.lease.lease_token,lease.lease_token);receipt.leases.push(r.lease);
  assert.equal(await heartbeatSharedResourceLease(pool,{resourceId:'g6-shared',leaseToken:lease.lease_token}),false);
  assert.equal((await restarted.ask({action:'release',token:lease.lease_token})).released,false);
  assert.equal((await row('select lease_token from tigeriq_ai_resource_leases')).lease_token,r.lease.lease_token);
  assert.equal((await restarted.ask({action:'release',token:r.lease.lease_token})).released,true);
  assert.equal(restartRecoveryDecision({status:'running'},null).action,'queue');
  return {dead_worker:open.worker_id,restarted_worker:r.worker_id,expired_lease_id:lease.lease_token,new_lease_id:r.lease.lease_token,real_ttl_wait:true,committed_rows:0};
 });
 await scenario('bounded_retry_persisted_across_restart',async()=>{
  const receipts=[];
  for(let n=0;n<3;n++){
   const w=await ready(),r=await w.ask({action:'retry'});receipts.push(r);await kill(w);
   if(n===2){assert.equal(r.decision.code,'CODING_SAME_FAILURE_STOP');assert.equal(r.decision.allow,false);assert.equal(r.attempts,2);}
   else{assert.equal(r.decision.allow,true);assert.equal(r.attempts,n+1);}
  }
  assert.equal(staleRunningRecoveryDecision({status:'running',started_at:'2020-01-01',stale_recovery_count:2},{maxRequeues:2,active:false}).code,'CODING_STALE_RUNNING_RETRY_EXHAUSTED');
  return {failed_attempts:2,third_dispatch:false,receipts,scope:'real worker restarts + canonical retry decision + durable PG history; not production scheduler restart'};
 });
 await scenario('postgres_read_only_permission_denied',async()=>{
  await pool.query('create role g6_readonly login');await pool.query('grant connect on database '+db+' to g6_readonly');
  await pool.query('grant usage on schema public to g6_readonly');await pool.query('grant select on all tables in schema public to g6_readonly');
  const readOnly=new Pool({host:socket,port:15439,user:'g6_readonly',database:db});
  try{await assert.rejects(readOnly.query("insert into g6_effects values('unauthorized','x')"),e=>e.code==='42501');}
  finally{await readOnly.end();}return {postgres_sqlstate:'42501',mutation_denied:true};
 });
 await scenario('real_worker_unauthorized_role_denied_before_model',async()=>{
  const w=await ready();
  await assert.rejects(w.ask({action:'model',role:'root',prompt:'DENIED_CANARY',schema:{}}),e=>e.code==='G6_MODEL_ROLE_DENIED');
  await kill(w);return {code:'G6_MODEL_ROLE_DENIED',model_invoked:false};
 });
 await scenario('native_service_missing_scoped_credential_fails_closed',async()=>{
  // Probe the unchanged service entrypoint, with only the disposable DB.
  // Do not export connector credentials or broaden workflow write permissions.
  let stderr='';
  try{execFileSync(process.execPath,['apps/tigeriq-coding-lane/coding-lane.mjs'],{
   env:{...env,NODE_ENV:'production',DATABASE_URL:'postgresql://'+username+'@localhost/'+db+'?host='+encodeURIComponent(socket)+'&port=15439'},encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});}
  catch(e){stderr=String(e.stderr||'');}
  assert.match(stderr,/GITHUB_TOKEN_MISSING/);
  receipt.native_dispatch={status:'REAL_WORKER_E2E_BLOCKED',code:'GITHUB_TOKEN_MISSING',
   detail:'Native service requires a GitHub writer token and native eligible independent reviewer. This read-only public workflow has no branch-scoped writer adapter; the connector credential cannot be exported. Native source also plans/writes against main, outside this isolated branch contract. No privilege or source bypass performed.'};
  return {expected_admission:'DENIED',code:'GITHUB_TOKEN_MISSING',native_runtime_accepted:false};
 });
 // Actual model calls, each in a distinct OS process and stateless model context.
 // The model has no shell, PG connection, credentials or repository mounts.
 const skills=loadRequiredCodingSkills('P0 #4902 isolated G6',{requiredIds:['spec-first-tdd']});
 const skillBytes=readFileSync('docs/skills/spec-first-tdd/SKILL.md');
 assert.equal(skills.proof[0].bytes,skillBytes.length);
 receipt.skill={id:skills.proof[0].id,version:skills.proof[0].version,status:'ACTIVE',bytes:skillBytes.length,content_sha256:sha256(skillBytes),proof:skills.proof};
 const tags=await fetch('http://127.0.0.1:11435/api/tags',{signal:AbortSignal.timeout(5000)}).then(r=>{assert.equal(r.ok,true);return r.json();});
 const installed=tags.models.find(x=>x.name==='qwen2.5-coder:7b');assert.match(installed?.digest||'',/^[a-f0-9]{64}$/);
 receipt.model_weights={id:installed.name,digest:installed.digest,size:installed.size};
 receipt.images={model:execFileSync('docker',['image','inspect','ollama/ollama:0.12.11','--format','{{index .RepoDigests 0}}'],{encoding:'utf8'}).trim(),tool:execFileSync('docker',['image','inspect','node:22-bookworm-slim','--format','{{index .RepoDigests 0}}'],{encoding:'utf8'}).trim()};
 const spec='Implement export function total(values). Return null unless values is an array of at most 100 integers, each between 0 and 1000 inclusive. Return the sum for valid arrays, including zero for empty. No coercion. Only sandbox/candidate.mjs may change.';
 const job={step_id:'G6',title:'Isolated technical product',instruction:spec,paths:['sandbox/candidate.mjs'],deliverable_type:'source',required_changed_paths:['sandbox/candidate.mjs'],steps:['Read Skill and specification','Implement total','Run independent checks'],acceptance:['Exact integer-array semantics','Independent review and functional evidence'],evidence_required:['Candidate bytes','Docker execution receipt']};
 let packet=compileCodingStepPacket({objectiveId:'G6-WORK-4902',sourceRevision:source,sourceHeadSha:source,job,allowedPaths:job.paths,skillEvidence:skills.proof});
 const call=async(role,extra,schema)=>{
  const w=await ready();
  const prompt=codingRolePrompt({role,packet,skillContext:skills.contextBlock,context:spec})+'\nSKILL_FILE_SHA256='+receipt.skill.content_sha256+'\n'+extra;
  const result=await w.ask({action:'model',role,prompt,schema});assert.equal(result.event,'model');receipt.models.push(result);receipt.leases.push(result.lease);save();return result;
 };
 const schema=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
 const manager=await call('manager','Return ONLY JSON with instruction defining this exact bounded step. Do not expand scope.',schema({instruction:{type:'string',minLength:20,maxLength:1000}}));
 assert.ok(manager.parsed.instruction);packet=compileCodingStepPacket({objectiveId:'G6-WORK-4902',sourceRevision:source,sourceHeadSha:source,job:{...job,instruction:spec+'\nManager plan: '+manager.parsed.instruction},allowedPaths:job.paths,skillEvidence:skills.proof});
 const implementer=await call('implementer','Return ONLY JSON {"code":"export function total(values) { ... }"}. Do not run tools or add imports. Implement the specification completely.',schema({code:{type:'string',minLength:30,maxLength:2400}}));
 const code=implementer.parsed.code;assert.match(code,/export\s+function\s+total\s*\(/);
 assert.equal(verifyCodingDeliverable({packet,changes:[{path:'sandbox/candidate.mjs',content:code}]}).pass,true);
 receipt.candidate_sha256=sha256(code);writeFileSync(join(out,'candidate.mjs'),code);
 const toolDir=join(dir,'tool');mkdirSync(toolDir);chmodSync(toolDir,0o755);writeFileSync(join(toolDir,'candidate.mjs'),code,{mode:0o644});
 const cases=[[],[1,2,3],[0,1000],null,'12',[1.5],[-1],[1001],['1'],Array(101).fill(0),{},[Number.MAX_SAFE_INTEGER]];
 const expected=[0,6,1000,null,null,null,null,null,null,null,null,null];
 writeFileSync(join(toolDir,'check.mjs'),'import {total} from "./candidate.mjs";\nconsole.log(JSON.stringify('+JSON.stringify(cases)+'.map(v=>total(v))));\n',{mode:0o644});
 await scenario('model_generated_function_real_sandbox_tool',async()=>{
  const name='g6-work-tool-'+randomBytes(5).toString('hex');containers.add(name);
  const stdout=execFileSync('docker',['run','--rm','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--memory','256m','--cpus','1','--user','65534:65534','--mount','type=bind,src='+toolDir+',dst=/work,readonly',receipt.images.tool,'node','/work/check.mjs'],{encoding:'utf8',timeout:20000,maxBuffer:65536});
  containers.delete(name);assert.deepEqual(JSON.parse(stdout),expected);
  receipt.tool={id:receipt.images.tool,network:'none',read_only:true,exit_code:0,stdout,stdout_sha256:sha256(stdout),candidate_sha256:sha256(code)};
  receipt.functional={pass:true,tested:12,candidate_sha256:sha256(code),expected,actual:JSON.parse(stdout)};
  return receipt.functional;
 });
 const reviewer=await call('reviewer','Review ONLY this candidate against original specification. No implementer conversation is shared. Return approve only if fully correct. Candidate SHA256='+sha256(code)+'\nCODE:\n'+code,schema({decision:{type:'string',enum:['approve','changes_requested']},summary:{type:'string'}}));
 assertIndependentReviewApproval({implementerId:implementer.worker_id,reviewerId:reviewer.worker_id,targetHead:source,expectedHead:source,decision:reviewer.parsed.decision});
 const acceptor=await call('acceptor','Decide sandbox functional acceptance only, not Production or full G6. Candidate SHA256='+sha256(code)+'\nCODE:\n'+code+'\nHost-executed independent functional evidence: '+JSON.stringify(receipt.functional)+'\nReview: '+JSON.stringify(reviewer.parsed),schema({decision:{type:'string',enum:['accept','reject']},summary:{type:'string'}}));
 assert.equal(acceptor.parsed.decision,'accept');
 await scenario('four_actual_model_roles_functional_handoff',async()=>{const result=verifySandboxReceipt(receipt);assert.equal(result.pass,true);return result;});
 await scenario('all_role_leases_released',async()=>{
  let remaining=1;
  for(let n=0;n<20;n++){
   remaining=Number((await row('select count(*) from tigeriq_ai_resource_leases')).count);
   if(!remaining)break;await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(remaining,0);return {remaining_leases:remaining};
 });
 await scenario('canonical_product_gate_does_not_accept_sandbox_receipt',async()=>{
  const productPacket={...packet,deliverable_type:'backend',required_checks:['Backend Contract Verify']};
  await assert.rejects(verifyCodingCanaryProductGate({packet:productPacket,sourceHeadSha:source,prHeadSha:source,changedPaths:packet.paths,repositoryFullName:'newsdayads/tigeriq-ai-lab',evaluateProduct:evaluateProductAcceptance}),/CODING_PRODUCT_PROVIDER_ADAPTER_UNAVAILABLE/);
  return {accepted:false,code:'CODING_PRODUCT_PROVIDER_ADAPTER_UNAVAILABLE',reason:'Real G5 module is present and unchanged. Generated temporary source has no exact-source GitHub product check; no fake provider adapter supplied'};
 });
 await scenario('sandbox_artifact_rollback_preserves_source',async()=>{
  const before=sha256(readFileSync('apps/tigeriq-coding-lane/coding-lane.mjs'));
  rmSync(toolDir,{recursive:true,force:true});
  assert.equal(sha256(readFileSync('apps/tigeriq-coding-lane/coding-lane.mjs')),before);
  assert.equal(execFileSync('git',['diff','--exit-code'],{encoding:'utf8'}),'');
  return {repository_unchanged:true,scope:'temporary sandbox artifact removal + PG crash transaction rollback; not production deployment rollback'};
 });
 receipt.status='IMPORTED_COMPONENT_SANDBOX_VERIFIED';
 receipt.open_issues.push({code:'REAL_WORKER_E2E_BLOCKED',detail:'Production Core intake/manager dispatch and native runJob lifecycle are not started by this isolated harness. Four real local model processes plus canonical imported components are verified separately. No installed runtime/release rollback acceptance.'});
}catch(e){receipt.status='FAIL';receipt.error=e.code||e.message;receipt.error_message=e.message;process.exitCode=1;}
finally{
 for(const child of children)child.kill('SIGKILL');
 await Promise.all([...children].map(c=>new Promise(resolve=>c.once('exit',resolve))));
 for(const name of containers){try{execFileSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});}catch{}}
 if(pool)await pool.end();
 if(started){try{pgRun('pg_ctl',['-D',data,'-m','immediate','-w','stop']);receipt.cleanup.postgres_stopped=true;}catch(e){receipt.cleanup.error=e.message;process.exitCode=1;}}
 rmSync(dir,{recursive:true,force:true});
 receipt.cleanup.verified=receipt.cleanup.postgres_stopped===true&&!children.size;
 if(!receipt.cleanup.verified)process.exitCode=1;
 save();console.log('G6_WORK_RECEIPT='+JSON.stringify({...receipt,models:receipt.models.map(({prompt,response,...r})=>r)}));
}
