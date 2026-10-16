import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
const current=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const deny=x=>{throw Error(x)};
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='newsdayads/tigeriq-ai-lab'||
process.env.GITHUB_REF!=='refs/heads/p0/owner-vy-core-coding-contract-20261016'||
current!==process.env.GITHUB_SHA||!process.env.DATABASE_URL||!process.env.GITHUB_TOKEN)deny('G6_ISOLATION_PERMISSION_MISSING');
const dir=mkdtempSync(join(tmpdir(),'g6-native-version-'));
const known=join(dir,'known'),bad=join(dir,'fault');
const file='apps/tigeriq-coding-lane/coding-lane.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const exec=(...args)=>execFileSync('git',args,{cwd:process.cwd(),stdio:'ignore'});
const rec={source_sha:current,scope:'GITHUB_BRANCH_ONLY',pc01:false,production:false,
native_multi_agent_verified:false,writer_authenticated:false,
status:'BLOCKED',scenario:[],cleanup:false};
let child=null,db=null,port=0;
const check=(name,value)=>{if(!value)deny(name);rec.scenario.push({name,pass:true});};
async function stop(){
 if(!child)return;
 const p=child;child=null;p.kill('SIGTERM');
 await Promise.race([once(p,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,3500))]);
 if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');
 if(p.exitCode===null&&p.signalCode===null)await Promise.race([once(p,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,2500))]);
 check('PROCESS_STOPPED',p.exitCode!==null||p.signalCode!==null);
}
async function portFree(){
 const n=createServer();n.listen(0,'127.0.0.1');await once(n,'listening');
 const p=n.address().port;await new Promise(r=>n.close(r));return p;
}
async function boot(root){
 const env={...process.env,NODE_ENV:'production',TIGERIQ_CODING_AUTO_MERGE:'false',
 TIGERIQ_CODING_HOST:'127.0.0.1',TIGERIQ_CODING_PORT:String(port),
 TIGERIQ_CORE_STATUS_URL:'http://127.0.0.1:9/api/status',TIGERIQ_CODING_MAX_PARALLEL:'1'};
 child=spawn(process.execPath,[join(root,file)],{cwd:root,env,stdio:'ignore'});
 const end=Date.now()+35000;
 while(Date.now()<end){
   if(child.exitCode!==null)deny('NATIVE_RUNTIME_EXITED');
   try{
     const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(1200)});
     if(r.status===200)return await r.json();
   }catch{}
   await new Promise(r=>setTimeout(r,300));
 }
 deny('NATIVE_RUNTIME_START_TIMEOUT');
}
try{
 for(const d of [known,bad]){
   exec('worktree','add','--detach',d,current);
   symlinkSync(resolve('node_modules'),join(d,'node_modules'),'dir');
 }
 const before=readFileSync(join(known,file),'utf8');
 const needle="JSON.stringify({ok:true,service:'tigeriq-coding-lane'";
 const after=readFileSync(join(bad,file),'utf8');
 check('FAULT_ANCHOR_EXACT',after.split(needle).length===2);
 writeFileSync(join(bad,file),after.replace(needle,"JSON.stringify({ok:false,service:'tigeriq-coding-lane'"));
 rec.known_sha256=hash(before);
 rec.fault_sha256=hash(readFileSync(join(bad,file),'utf8'));
 port=await portFree();
 db=new pg.Pool({connectionString:process.env.DATABASE_URL});
 check('NATIVE_BASELINE_HEALTH',(await boot(known)).ok===true);
 const id='G6-HOLD-'+randomUUID();
 await db.query("insert into tigeriq_coding_objectives (id,objective,priority,status) values ($1,$2,'P0','waiting_owner')",
   [id,'G6 isolated native rollback only']);
 await stop();
 check('FAULTY_NATIVE_HEALTH_REJECTED',(await boot(bad)).ok===false);
 await stop();
 check('KNOW_GOOD_SOURCE_UNMODIFIED',hash(readFileSync(join(known,file),'utf8'))===rec.known_sha256);
 check('ROLLBACK_NATIVE_HEALTH_RESTORED',(await boot(known)).ok===true);
 const a=(await db.query('select status from tigeriq_coding_objectives where id=$1',[id])).rows;
 check('OWNER_HOLD_DURABLE',a.length===1&&a[0].status==='waiting_owner');
 const jobs=(await db.query('select id,title from tigeriq_coding_jobs')).rows;
 check('ONLY_BUILTIN_STALE_WATCHDOG_PRESENT',jobs.length===1&&
   jobs[0].id==='CODE-CANARY-A8-2068'&&jobs[0].title==='Canary A8 stale-running watchdog');
 check('NO_NATIVE_WORKER_DISPATCH',jobs.every(row=>row.id==='CODE-CANARY-A8-2068'));
 rec.status='NATIVE_ISOLATED_VERSION_ROLLBACK_VERIFIED';
}catch(e){rec.error=String(e.message||e);process.exitCode=1}
finally{
 try{await stop()}catch(e){rec.cleanup_error=String(e);process.exitCode=1}
 if(db)try{await db.end()}catch(e){rec.cleanup_error=String(e);process.exitCode=1}
 for(const p of [bad,known])try{exec('worktree','remove','--force',p)}catch(e){rec.cleanup_error=String(e);process.exitCode=1}
 rmSync(dir,{recursive:true,force:true});
 rec.cleanup=(!child&&!rec.cleanup_error);
 mkdirSync('p0-g6-native-rollback-evidence',{recursive:true});
 writeFileSync('p0-g6-native-rollback-evidence/receipt.json',JSON.stringify(rec,null,2)+'\n');
 console.log('G6_NATIVE_ROLLBACK_RECEIPT='+JSON.stringify(rec));
 if(rec.status!=='NATIVE_ISOLATED_VERSION_ROLLBACK_VERIFIED'||!rec.cleanup)process.exitCode=1;
}