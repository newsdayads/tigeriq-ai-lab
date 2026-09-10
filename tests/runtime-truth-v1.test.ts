import { describe, expect, test } from 'vitest';
import { buildRuntimeTruth } from '../apps/workforce-controller/src/runtime-truth.js';
import type { SqlPoolLike } from '../packages/work-state/src/postgres-repository.js';

const now=Date.parse('2026-09-09T05:00:00Z');
const pool={query:async(sql:string)=>{
  if(sql.includes('FROM employees e'))return {rows:[{employee_id:'EMP-PC01-NATIVE',display_name:'PC01 Native Worker',roles:['pc01-native-worker'],permissions:[],capabilities:['evidence'],employee_state:'active',concurrency_limit:4,employee_heartbeat:'2026-09-09T04:59:55Z',binding_id:'BIND-PC01-NATIVE',device_id:'DEV-PC01',platform:'windows-pc01',device_state:'active',device_heartbeat:'2026-09-09T04:59:55Z',health:'ok',heartbeat_metadata:{pid:1234,resources:{cpuPercent:20}},observed_at:'2026-09-09T04:59:55Z'}]};
  if(sql.includes('FROM ai_providers'))return {rows:[{provider_id:'P1',provider:'groq',model:'m1',independence_key:'groq',state:'active',last_heartbeat_at:'2026-09-09T04:59:55Z',metadata:{}}]};
  if(sql.includes('FROM jobs ORDER'))return {rows:[{job_id:'J1',title:'job',objective:'test',target_employee_id:'EMP-PC01-NATIVE',preferred_provider_id:null,priority:'P0',stage:'leased',attempts:1,max_attempts:2,last_failure_code:null,created_at:'2026-09-09T04:59:00Z',updated_at:'2026-09-09T04:59:56Z'}]};
  if(sql.includes("FROM leases WHERE status='active'"))return {rows:[{lease_id:'L1',job_id:'J1',employee_id:'EMP-PC01-NATIVE',device_id:'DEV-PC01',binding_id:'BIND-PC01-NATIVE',worker_kind:'pc01',attempt:1,status:'active',leased_at:'2026-09-09T04:59:56Z',expires_at:'2026-09-09T05:01:56Z'}]};
  if(sql.includes('SELECT stage,count(*)'))return {rows:[{stage:'queued',count:'2'},{stage:'leased',count:'1'},{stage:'done',count:'9'}]};
  throw new Error(`unexpected sql ${sql}`);
}} as unknown as SqlPoolLike;

describe('runtime-truth-v1',()=>{
  test('projects authoritative queue, heartbeat, provider and job state from PostgreSQL',async()=>{
    const truth=await buildRuntimeTruth(pool,now,45_000);
    expect(truth).toMatchObject({ok:true,protocol:'runtime-truth-v1',postgres:true,queue:{queued:2,activeLeases:1},pc01:{online:true,stale:false,health:'ok'}});
    expect(truth.providers).toHaveLength(1);expect(truth.jobs[0]).toMatchObject({jobId:'J1',stage:'leased'});expect(truth.leases[0]).toMatchObject({jobId:'J1',employeeId:'EMP-PC01-NATIVE'});
  });
});
