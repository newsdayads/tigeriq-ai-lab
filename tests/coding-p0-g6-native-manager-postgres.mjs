import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const sourceSha=String(process.env.GITHUB_SHA||''),branch='refs/heads/p0/owner-vy-core-coding-contract-20261016';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='newsdayads/tigeriq-ai-lab'||
  process.env.GITHUB_REF!==branch||!/^[0-9a-f]{40}$/.test(sourceSha)||
  execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==sourceSha||
  !process.env.DATABASE_URL)throw Error('G6_POSTGRES_ISOLATED_SOURCE_UNVERIFIED');
const source=readFileSync('apps/tigeriq-coding-lane/coding-lane.mjs','utf8');
const match=source.match(/async function managerTick\(\)\{\s*const q=await pool\.query\("([^"]+)"\)/);
if(!match)throw Error('G6_MANAGER_NATIVE_SQL_MISSING');
const realSql=match[1];
if(!realSql.includes("j.status in ('queued','running','review','waiting_ci','waiting_resource','waiting_owner')"))
  throw Error('G6_MANAGER_OWNER_HOLD_SCOPE_MISSING');
const schema='g6_hold_'+randomUUID().replaceAll('-','').slice(0,16);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
const events=[];const record=(name,passed)=>{events.push({name,pass:passed});if(!passed)throw Error('G6_MANAGER_'+name)};
const objective='G6-OWNER-'+randomUUID();
let cleanup=false,error=null;
try{
 await pool.query('CREATE SCHEMA "'+schema+'"');
 await pool.query('SET search_path TO "'+schema+'",public');
 await pool.query('CREATE TABLE tigeriq_coding_objectives(id text primary key,status text,priority text,next_attempt_at timestamptz,created_at timestamptz default now())');
 await pool.query('CREATE TABLE tigeriq_coding_jobs(id text primary key,objective_id text,status text)');
 await pool.query('INSERT INTO tigeriq_coding_objectives(id,status,priority) VALUES($1,$2,$3)',[objective,'active','P0']);
 const query=async()=> (await pool.query(realSql)).rows;
 record('READY_BEFORE_JOB',(await query()).length===1);
 const held=['queued','running','review','waiting_ci','waiting_resource','waiting_owner'];
 for(const status of held){
   await pool.query('DELETE FROM tigeriq_coding_jobs');
   await pool.query('INSERT INTO tigeriq_coding_jobs(id,objective_id,status) VALUES($1,$2,$3)', ['JOB-'+status,objective,status]);
   record('DENY_DUPLICATE_'+status.toUpperCase(),(await query()).length===0);
 }
 // Negative-control: an old Manager SQL lacking waiting_owner would repeat the job.
 const legacy=realSql.replace(",'waiting_owner'","");
 record('LEGACY_SQL_REPRODUCES_BUG', (await pool.query(legacy)).rows.length===1);
 record('CURRENT_SQL_BLOCKS_REPLAY',(await query()).length===0);
 await pool.query("UPDATE tigeriq_coding_objectives SET status='waiting_owner' WHERE id=$1",[objective]);
 record('OBJECTIVE_OWNER_HELD',(await query()).length===0);
 await pool.query("UPDATE tigeriq_coding_jobs SET status='done'");
 await pool.query("UPDATE tigeriq_coding_objectives SET status='active' WHERE id=$1",[objective]);
 record('TERMINAL_JOB_NO_ACTIVE_HOLD',(await query()).length===1);
}catch(e){error=String(e.message||e);process.exitCode=1}
finally{
 try{await pool.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');cleanup=true}
 catch(e){error=error||String(e);process.exitCode=1}
 await pool.end();
 const receipt={source_sha:sourceSha,execution:'github-actions-branch-isolated',query_provenance:'extracted-from-native-managerTick-source',
   verified:!error&&events.length===11&&events.every(x=>x.pass)&&cleanup,
   events,cleanup,pc01:false,github_write:false,error};
 mkdirSync('p0-g6-manager-db-evidence',{recursive:true});
 writeFileSync('p0-g6-manager-db-evidence/receipt.json',JSON.stringify(receipt,null,2)+'\n');
 console.log('G6_NATIVE_MANAGER_PG_RECEIPT='+JSON.stringify(receipt));
 if(!receipt.verified)process.exitCode=1;
}