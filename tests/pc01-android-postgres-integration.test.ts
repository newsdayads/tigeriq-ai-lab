import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPgPool } from '../packages/work-state/src/pg-driver.js';
import { PostgresOperationalStateRepository, type SqlPoolLike } from '../packages/work-state/src/postgres-repository.js';
import { OperationalWorkService } from '../packages/work-state/src/service.js';
import { WorkforceControllerV1 } from '../apps/workforce-controller/src/controller.js';

const databaseUrl=process.env.TIGERIQ_TEST_DATABASE_URL?.trim();
const integration=databaseUrl?describe:describe.skip;

function sha256(value:Buffer|string):string{return createHash('sha256').update(value).digest('hex');}
function json(value:unknown):Buffer{return Buffer.from(JSON.stringify(value),'utf8');}

integration('PC01 Android -> Controller -> PostgreSQL -> Result integration',()=>{
  let pool:SqlPoolLike;
  let repo:PostgresOperationalStateRepository;
  let service:OperationalWorkService;
  let controller:WorkforceControllerV1;
  const employeeId='EMP-ANDROID-001',deviceId='DEV-ANDROID-001',bindingId='BIND-ANDROID-001',nodeId='NODE-ANDROID-001';
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const publicKeyDer=keys.publicKey.export({format:'der',type:'spki'}) as Buffer;
  const publicKeyBase64=publicKeyDer.toString('base64');
  const fingerprint=sha256(publicKeyDer);
  let nonceCounter=0;

  function signedRequest(method:string,path:string,body:Buffer,nowMs=Date.now()){
    const nonce=`android-integration-${++nonceCounter}-${nowMs}`;
    const timestamp=String(nowMs);
    const canonical=`${method}\n${path}\n${employeeId}\n${nodeId}\n${deviceId}\n${timestamp}\n${nonce}\n${sha256(body)}`;
    return {
      method,path,body,nowMs,
      headers:{
        'x-tigeriq-device-proof-v':'1','x-tigeriq-employee-id':employeeId,'x-tigeriq-node-id':nodeId,
        'x-tigeriq-device-id':deviceId,'x-tigeriq-device-key-fingerprint':fingerprint,
        'x-tigeriq-device-public-key':publicKeyBase64,'x-tigeriq-device-timestamp':timestamp,
        'x-tigeriq-device-nonce':nonce,'x-tigeriq-device-challenge':sha256(canonical),
        'x-tigeriq-device-signature':sign('sha256',Buffer.from(canonical,'utf8'),keys.privateKey).toString('base64url'),
      },
    };
  }

  beforeAll(async()=>{
    pool=await createPgPool(databaseUrl!,4);
    const migration=await readFile('db/migrations/001_operational_state_v1.sql','utf8');
    await pool.query(migration);
    await pool.query(`TRUNCATE heartbeats,prompt_metrics,prompts,evidence,reviews,results,leases,job_scopes,job_dependencies,jobs,goals,ai_providers,employee_device_bindings,devices,employees RESTART IDENTITY CASCADE`);
    repo=new PostgresOperationalStateRepository(pool);
    service=new OperationalWorkService(repo);
    controller=new WorkforceControllerV1(pool,service);
    const now=new Date().toISOString();
    await repo.upsertEmployee({employeeId,displayName:'Android AI Employee',roles:['worker'],permissions:['jobs:lease','jobs:submit'],capabilities:['ai-direct','gemini'],state:'active',concurrencyLimit:1,createdAt:now,updatedAt:now});
    await repo.upsertDevice({deviceId,platform:'android',publicKeyFingerprint:fingerprint,state:'active',metadata:{publicKeyBase64,nodeId},createdAt:now,updatedAt:now});
    await repo.bindDevice({bindingId,employeeId,deviceId,state:'active',createdAt:now,updatedAt:now});
  });

  afterAll(async()=>{const closable=pool as SqlPoolLike&{end?:()=>Promise<void>};if(closable?.end)await closable.end();});

  it('authenticates device, leases one job, persists result/evidence once, and rejects replay/conflict',async()=>{
    const createdAt=new Date().toISOString();
    await service.createJob({jobId:'JOB-ANDROID-001',idempotencyKey:'android-e2e-001',title:'Android integration',objective:'Run phone-owned AI and return result',payload:{prompt:'Return TIGERIQ OK'},targetEmployeeId:employeeId,requiredPermissions:['jobs:lease','jobs:submit'],requiredCapabilities:['ai-direct','gemini'],allowedWorkerKinds:['device'],expectedEvidence:['json'],scopeKeys:['pc01/android/integration'],dependencies:[],maxAttempts:3,independentReview:false,judgeRequired:false,priority:'P0',createdAt});

    const leaseBody=json({leaseTtlMs:60_000});
    const leaseRequest=signedRequest('POST','/api/v1/jobs/lease',leaseBody);
    const leased=await controller.handle(leaseRequest);
    expect(leased.status).toBe(200);
    const lease=(leased.body.lease??null) as Record<string,unknown>;
    expect(lease.jobId).toBe('JOB-ANDROID-001');
    expect(lease.employeeId).toBe(employeeId);
    expect(lease.deviceId).toBe(deviceId);
    expect(lease.bindingId).toBe(bindingId);
    expect(typeof lease.leaseToken).toBe('string');

    const replay=await controller.handle(leaseRequest);
    expect(replay.status).toBe(409);
    expect((replay.body.error as Record<string,unknown>).code).toBe('DEVICE_PROOF_REPLAY');

    const duplicatePull=await controller.handle(signedRequest('POST','/api/v1/jobs/lease',leaseBody));
    expect(duplicatePull.status).toBe(200);
    expect(duplicatePull.body.lease).toBeNull();

    const heartbeatBody=json({health:'ok',metadata:{source:'android-integration'}});
    const heartbeat=await controller.handle(signedRequest('POST',`/api/v1/devices/${deviceId}/heartbeat`,heartbeatBody));
    expect(heartbeat.status).toBe(200);

    const completedAt=new Date().toISOString();
    const resultBody=json({
      leaseId:lease.leaseId,leaseToken:lease.leaseToken,
      result:{status:'completed',completedAt,output:{text:'TIGERIQ OK',provider:'gemini',model:'gemini-test',timestamps:{completedAt},attempts:1,failover:{used:false},errors:[]},evidence:[{kind:'json',ref:`tigeriq://${employeeId}/JOB-ANDROID-001/phone-ai-result.json`,summary:'simulated Android result',sha256:'a'.repeat(64)}]},
    });
    const accepted=await controller.handle(signedRequest('POST','/api/v1/jobs/JOB-ANDROID-001/result',resultBody));
    expect(accepted.status).toBe(200);
    const acceptedResult=accepted.body.result as Record<string,unknown>;
    expect(acceptedResult.jobId).toBe('JOB-ANDROID-001');
    const resultId=acceptedResult.resultId;

    const duplicateResult=await controller.handle(signedRequest('POST','/api/v1/jobs/JOB-ANDROID-001/result',resultBody));
    expect(duplicateResult.status).toBe(200);
    expect((duplicateResult.body.result as Record<string,unknown>).resultId).toBe(resultId);

    const conflicting=json({
      leaseId:lease.leaseId,leaseToken:lease.leaseToken,
      result:{status:'completed',completedAt,output:{text:'CONFLICT',provider:'gemini',model:'gemini-test'},evidence:[{kind:'json',ref:'tigeriq://conflict',sha256:'b'.repeat(64)}]},
    });
    const conflict=await controller.handle(signedRequest('POST','/api/v1/jobs/JOB-ANDROID-001/result',conflicting));
    expect(conflict.status).toBe(409);
    expect((conflict.body.error as Record<string,unknown>).code).toBe('IDEMPOTENCY_CONFLICT');

    const counts=await pool.query<{results:string;evidence:string;stage:string;lease_status:string}>(`SELECT (SELECT count(*) FROM results WHERE job_id='JOB-ANDROID-001')::text results,(SELECT count(*) FROM evidence WHERE job_id='JOB-ANDROID-001')::text evidence,(SELECT stage FROM jobs WHERE job_id='JOB-ANDROID-001') stage,(SELECT status FROM leases WHERE job_id='JOB-ANDROID-001' ORDER BY attempt DESC LIMIT 1) lease_status`);
    expect(counts.rows[0]).toMatchObject({results:'1',evidence:'1',stage:'done',lease_status:'completed'});
  });

  it('recovers an expired Android lease after simulated PC01 restart',async()=>{
    const simulatedLeaseAt=Date.now()-120_000;
    const createdAt=new Date(simulatedLeaseAt-5_000).toISOString();
    await service.createJob({jobId:'JOB-ANDROID-RECOVERY',idempotencyKey:'android-recovery-001',title:'Android recovery',objective:'Prove restart recovery',payload:{prompt:'recovery'},targetEmployeeId:employeeId,requiredPermissions:['jobs:lease'],requiredCapabilities:['ai-direct'],allowedWorkerKinds:['device'],expectedEvidence:['json'],scopeKeys:['pc01/android/recovery'],dependencies:[],maxAttempts:3,independentReview:false,judgeRequired:false,priority:'P1',createdAt});
    const leaseBody=json({leaseTtlMs:60_000});
    const leased=await controller.handle(signedRequest('POST','/api/v1/jobs/lease',leaseBody,simulatedLeaseAt));
    expect(leased.status).toBe(200);
    expect((leased.body.lease as Record<string,unknown>).jobId).toBe('JOB-ANDROID-RECOVERY');

    const restartedRepo=new PostgresOperationalStateRepository(pool);
    const restartedService=new OperationalWorkService(restartedRepo);
    const recovery=await restartedService.recoverAfterRestart(new Date().toISOString());
    expect(recovery.expiredLeases).toBe(1);
    expect(recovery.requeuedJobs).toBe(1);
    const snapshot=await restartedRepo.getJob('JOB-ANDROID-RECOVERY');
    expect(snapshot?.job.stage).toBe('queued');
    expect(snapshot?.lease?.status).toBe('expired');

    const status=await new WorkforceControllerV1(pool,restartedService).handle({method:'GET',path:'/api/v1/status',headers:{},body:Buffer.alloc(0)});
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ok:true,protocol:'controller-v1',postgres:true,migration:'001_operational_state_v1'});
  });
});
