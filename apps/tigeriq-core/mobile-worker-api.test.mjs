import { afterEach, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { GATE_C_V020_COUNT, GATE_C_V020_VERSION, GATE_C_V021_COUNT, GATE_C_V021_VERSION, LIVE_WORKER_VERSION, createMobileWorkerApi, enqueueFreshLiveMobileTask, gateCV020Aggregate, gateCV020TaskSpecs, gateCV021Aggregate, gateCV021TaskSpecs, liveMobileCompletionToken, liveMobileTaskPrompt, mobileTaskLeaseFresh, mobileTaskResultDigest, mobileTaskTerminalDecision, normalizeMobileProvider, readMobileReleaseManifest, verifyCoreEnqueueAuth, verifyMobilePairingProof } from './mobile-worker-api.mjs';

let tempPath='';
afterEach(()=>{
  if(tempPath)rmSync(tempPath,{recursive:true,force:true});
  tempPath='';
  delete process.env.TIGERIQ_MOBILE_RELEASE_MANIFEST;
});

describe('mobile worker api helpers',()=>{
  it('verifies Android-compatible P256 challenge proof',()=>{
    const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const challenge='tigeriq-mobile-proof';
    const proof=sign('sha256',Buffer.from(challenge),privateKey).toString('base64url');
    const publicKeyBase64=publicKey.export({type:'spki',format:'der'}).toString('base64');
    expect(verifyMobilePairingProof({publicKey:publicKeyBase64,challenge,proof})).toBe(true);
    expect(verifyMobilePairingProof({publicKey:publicKeyBase64,challenge:'tampered',proof})).toBe(false);
  });

  it('normalizes the two pilot providers',()=>{
    expect(normalizeMobileProvider('Gemini')).toBe('Gemini');
    expect(normalizeMobileProvider('anything-else')).toBe('ChatGPT');
  });

  it('builds a deterministic v0.22 live-worker token without exposing it contiguously in the prompt',()=>{
    expect(LIVE_WORKER_VERSION).toBe('0.22.0-live-worker');
    const token=liveMobileCompletionToken('github:4000:abc123');
    expect(token).toMatch(/^TIGERIQ_MOBILE_DONE_[A-F0-9]{16}$/);
    expect(liveMobileCompletionToken('github:4000:abc123')).toBe(token);
    const prompt=liveMobileTaskPrompt({title:'Read-only task',body:'Summarize the supplied evidence.',expectedToken:token});
    expect(prompt).toContain('TIGERIQ_MOBILE_ + DONE_ + ');
    expect(prompt).not.toContain(token);
    expect(prompt.length).toBeLessThanOrEqual(3900);
  });

  it('enqueues a live task only to one fresh exact-version device and is idempotent',async()=>{
    const rows=[];
    const now=new Date('2026-10-04T07:00:00Z');
    const db={
      async query(sql,params=[]){
        if(sql.startsWith('select * from tigeriq_mobile_tasks where idempotency_key=')){
          const row=rows.find(x=>x.idempotency_key===params[0]);
          return {rowCount:row?1:0,rows:row?[row]:[]};
        }
        if(sql.includes('from tigeriq_mobile_devices')){
          expect(params[0]).toBe(LIVE_WORKER_VERSION);
          expect(new Date(params[1]).getTime()).toBe(now.getTime()-120000);
          return {rowCount:1,rows:[{node_id:'node-live',employee_id:'NV101',provider:'ChatGPT',agent_version:LIVE_WORKER_VERSION,last_seen_at:now.toISOString()}]};
        }
        if(sql.startsWith('insert into tigeriq_mobile_tasks')){
          rows.push({
            task_id:params[0],idempotency_key:params[1],target_node_id:params[2],employee_id:params[3],
            provider:params[4],prompt:params[5],expected_token:params[6],run_id:params[7],status:'queued'
          });
          return {rowCount:1,rows:[]};
        }
        throw new Error('unexpected db sql: '+sql);
      }
    };
    const token=liveMobileCompletionToken('seed');
    const prompt=liveMobileTaskPrompt({title:'Task',body:'Return useful evidence.',expectedToken:token});
    const first=await enqueueFreshLiveMobileTask(db,{idempotencyKey:'github-mobile:1:rev',prompt,expectedToken:token,now});
    expect(first).toMatchObject({idempotent:false,nodeId:'node-live',employeeId:'NV101',status:'queued'});
    const second=await enqueueFreshLiveMobileTask(db,{idempotencyKey:'github-mobile:1:rev',prompt,expectedToken:token,now});
    expect(second).toMatchObject({idempotent:true,taskId:first.taskId,runId:first.runId,nodeId:'node-live',employeeId:'NV101'});
    expect(rows).toHaveLength(1);
  });

  it('fails closed when no fresh v0.22 live worker is enrolled',async()=>{
    const db={async query(sql){
      if(sql.startsWith('select * from tigeriq_mobile_tasks'))return {rowCount:0,rows:[]};
      if(sql.includes('from tigeriq_mobile_devices'))return {rowCount:0,rows:[]};
      throw new Error('unexpected db sql: '+sql);
    }};
    const token=liveMobileCompletionToken('missing');
    await expect(enqueueFreshLiveMobileTask(db,{
      idempotencyKey:'github-mobile:2:rev',
      prompt:liveMobileTaskPrompt({title:'Task',body:'Do it.',expectedToken:token}),
      expectedToken:token
    })).rejects.toThrow('MOBILE_LIVE_WORKER_UNAVAILABLE');
  });

  it('requires the existing Core token for mobile task enqueue',()=>{
    const req=(authorization)=>({headers:{authorization}});
    expect(verifyCoreEnqueueAuth(req('Bearer core-secret'),'core-secret')).toBe(true);
    expect(verifyCoreEnqueueAuth(req('Bearer wrong'),'core-secret')).toBe(false);
    expect(verifyCoreEnqueueAuth(req(''),'core-secret')).toBe(false);
    expect(verifyCoreEnqueueAuth(req('Bearer core-secret'),'')).toBe(false);
  });

  it('fails closed on stale or wrong leases before terminal retry idempotency',()=>{
    const now=Date.parse('2026-10-03T07:30:00Z');
    expect(mobileTaskLeaseFresh({currentLeaseId:'ML-current',leaseId:'ML-current',leaseExpiresAt:'2026-10-03T07:35:00Z',now})).toBe(true);
    expect(mobileTaskLeaseFresh({currentLeaseId:'ML-current',leaseId:'ML-stale',leaseExpiresAt:'2026-10-03T07:35:00Z',now})).toBe(false);
    expect(mobileTaskLeaseFresh({currentLeaseId:'ML-current',leaseId:'ML-current',leaseExpiresAt:'2026-10-03T07:29:59Z',now})).toBe(false);
  });

  it('rejects a wrong worker before terminal idempotent retry acceptance',async()=>{
    const incoming={status:'completed',output:{token:'TIGERIQ_GATE_C_OK'}};
    const digest=mobileTaskResultDigest(incoming);
    const device={
      node_id:'node-wrong',employee_id:'NV202',credential_id:'cred-wrong',
      token_hash:createHash('sha256').update('mobile-token').digest('hex'),
      provider:'ChatGPT',department:'Engineering',role:'Android Worker Pilot'
    };
    let committed=false;
    const client={
      async query(sql){
        if(sql==='begin')return {rowCount:0,rows:[]};
        if(sql==='rollback')return {rowCount:0,rows:[]};
        if(sql==='commit'){committed=true;return {rowCount:0,rows:[]};}
        if(sql.startsWith('select * from tigeriq_mobile_tasks where task_id=')){
          return {rowCount:1,rows:[{
            task_id:'MT-1',target_node_id:'node-owner',employee_id:'NV201',
            status:'completed',result_digest:digest,lease_id:'ML-1',
            lease_expires_at:new Date(Date.now()+60_000).toISOString()
          }]};
        }
        throw new Error('unexpected client sql: '+sql);
      },
      release(){}
    };
    const pool={
      async query(sql){
        if(sql.startsWith('select * from tigeriq_mobile_devices')){
          return {rowCount:1,rows:[device]};
        }
        throw new Error('unexpected pool sql: '+sql);
      },
      async connect(){return client;}
    };
    const handle=createMobileWorkerApi({pool});
    const payload=JSON.stringify({taskId:'MT-1',leaseId:'ML-1',result:incoming});
    const req={
      method:'POST',
      headers:{'x-tigeriq-credential-id':'cred-wrong',authorization:'Bearer mobile-token'},
      socket:{remoteAddress:'100.64.0.9'},
      async *[Symbol.asyncIterator](){yield Buffer.from(payload);}
    };
    const res={
      status:0,body:null,
      writeHead(status){this.status=status;},
      end(body){this.body=JSON.parse(body);}
    };
    await handle(req,res,new URL('http://core/api/mobile/tasks/result'));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ok:false,error:'mobile_task_wrong_worker'});
    expect(committed).toBe(false);
  });

  it('keeps terminal mobile task commits exactly-once across retries',()=>{
    for(let i=1;i<=10;i++){
      const result={status:'completed',output:{token:`TIGERIQ_GATE_C_OK_${i}`},seq:i};
      const first=mobileTaskTerminalDecision({status:'leased',currentDigest:'',incomingResult:result});
      expect(first).toMatchObject({accept:true,idempotent:false,conflict:false});
      const retry=mobileTaskTerminalDecision({status:'completed',currentDigest:first.digest,incomingResult:result});
      expect(retry).toMatchObject({accept:false,idempotent:true,conflict:false});
      const conflict=mobileTaskTerminalDecision({
        status:'completed',
        currentDigest:first.digest,
        incomingResult:{...result,output:{token:'DIFFERENT'}},
      });
      expect(conflict).toMatchObject({accept:false,idempotent:false,conflict:true});
    }
  });

  it('builds a deterministic fixed 10-job v0.20 Gate C batch and validates exactly-once aggregate evidence',()=>{
    expect(GATE_C_V020_VERSION).toBe('0.20.0-update-lease-guard');
    expect(GATE_C_V020_COUNT).toBe(10);
    const specs=gateCV020TaskSpecs('NV101');
    expect(specs).toHaveLength(10);
    expect(specs[0]).toMatchObject({index:1,idempotencyKey:'gate-c:v020:NV101:01',expectedToken:'TIGERIQ_GATE_C_OK_1'});
    expect(specs[9]).toMatchObject({index:10,idempotencyKey:'gate-c:v020:NV101:10',expectedToken:'TIGERIQ_GATE_C_OK_10'});
    expect(new Set(specs.map(x=>x.idempotencyKey)).size).toBe(10);
    const rows=specs.map(spec=>({
      idempotency_key:spec.idempotencyKey,
      status:'completed',
      attempts:1,
      result:{output:{validatedToken:spec.expectedToken,sendCount:1,duplicateSendCount:0}},
    }));
    expect(gateCV020Aggregate(rows,'NV101')).toMatchObject({expected:10,taskCount:10,completed:10,failed:0,pending:0,invalid:0,pass:true});
    rows[4].result.output.duplicateSendCount=1;
    expect(gateCV020Aggregate(rows,'NV101')).toMatchObject({completed:10,invalid:1,pass:false});
  });

  it('builds a deterministic fixed 10-job v0.21 Gate C batch and validates exactly-once aggregate evidence',()=>{
    expect(GATE_C_V021_VERSION).toBe('0.21.0-packageinstaller-stream-fix');
    expect(GATE_C_V021_COUNT).toBe(10);
    const specs=gateCV021TaskSpecs('NV101');
    expect(specs).toHaveLength(10);
    expect(specs[0]).toMatchObject({index:1,idempotencyKey:'gate-c:v021:NV101:01',expectedToken:'TIGERIQ_GATE_C_OK_1'});
    expect(specs[9]).toMatchObject({index:10,idempotencyKey:'gate-c:v021:NV101:10',expectedToken:'TIGERIQ_GATE_C_OK_10'});
    expect(new Set(specs.map(x=>x.idempotencyKey)).size).toBe(10);
    const rows=specs.map(spec=>({
      idempotency_key:spec.idempotencyKey,
      status:'completed',
      attempts:1,
      result:{output:{validatedToken:spec.expectedToken,sendCount:1,duplicateSendCount:0,recoveryCount:spec.index===4?1:0}},
    }));
    expect(gateCV021Aggregate(rows,'NV101')).toMatchObject({
      expected:10,taskCount:10,completed:10,failed:0,queued:0,leased:0,pending:0,invalid:0,attemptCount:10,
      sendCount:10,duplicateSendCount:0,recoveryCount:1,pass:true
    });
    rows[4].result.output.duplicateSendCount=1;
    expect(gateCV021Aggregate(rows,'NV101')).toMatchObject({completed:10,invalid:1,sendCount:10,duplicateSendCount:1,recoveryCount:1,pass:false});
    rows[4].result.output.duplicateSendCount=0;
    rows[4].result.output.sendCount=2;
    const duplicateSendAttempt=gateCV021Aggregate(rows,'NV101');
    expect(duplicateSendAttempt).toMatchObject({completed:10,invalid:1,sendCount:11,duplicateSendCount:0,recoveryCount:1,pass:false});
    expect(duplicateSendAttempt.jobs[4]).toMatchObject({sendCount:2,duplicateSendCount:0,valid:false});
    rows[4].result.output.sendCount=1;

    const pendingRows=specs.map((spec,index)=>({
      idempotency_key:spec.idempotencyKey,
      status:index<2?'leased':'queued',
      attempts:index<2?1:0,
      result:null,
    }));
    expect(gateCV021Aggregate(pendingRows,'NV101')).toMatchObject({
      taskCount:10,completed:0,failed:0,queued:8,leased:2,pending:10,invalid:0,attemptCount:2,pass:false
    });

    rows[4].result.output.duplicateSendCount=0;
    delete rows[4].result.output.recoveryCount;
    const missingRecovery=gateCV021Aggregate(rows,'NV101');
    expect(missingRecovery).toMatchObject({completed:10,invalid:1,recoveryCount:0,pass:false});
    expect(missingRecovery.jobs[4]).toMatchObject({recoveryCount:null,valid:false});

    for(const malformed of [-1,1.5,null,false,'',[]]){
      rows[4].result.output.recoveryCount=malformed;
      const invalidRecovery=gateCV021Aggregate(rows,'NV101');
      expect(invalidRecovery).toMatchObject({completed:10,invalid:1,recoveryCount:0,pass:false});
      expect(invalidRecovery.jobs[4]).toMatchObject({recoveryCount:null,valid:false});
    }

    rows[4].result.output.recoveryCount=0;
    for(const malformed of [null,false,'',[],1.5,'1']){
      rows[4].result.output.sendCount=malformed;
      const invalidSend=gateCV021Aggregate(rows,'NV101');
      expect(invalidSend).toMatchObject({completed:10,invalid:1,sendCount:9,pass:false});
      expect(invalidSend.jobs[4]).toMatchObject({sendCount:null,valid:false});
    }

    rows[4].result.output.sendCount=1;
    for(const malformed of [null,false,'',[],1.5,'0']){
      rows[4].result.output.duplicateSendCount=malformed;
      const invalidDuplicate=gateCV021Aggregate(rows,'NV101');
      expect(invalidDuplicate).toMatchObject({completed:10,invalid:1,duplicateSendCount:0,pass:false});
      expect(invalidDuplicate.jobs[4]).toMatchObject({duplicateSendCount:null,valid:false});
    }
  });

  it('fails closed if the prechecked Gate C v0.20 target changes before insert',async()=>{
    let rolledBack=false;
    let insertBoundNode='';
    const now=new Date().toISOString();
    const client={
      async query(sql,params=[]){
        if(sql==='begin'||sql==='commit')return {rowCount:0,rows:[]};
        if(sql==='rollback'){rolledBack=true;return {rowCount:0,rows:[]};}
        if(sql.startsWith('select pg_advisory_xact_lock'))return {rowCount:1,rows:[{}]};
        if(sql.startsWith('select task_id from tigeriq_mobile_tasks'))return {rowCount:0,rows:[]};
        if(sql.startsWith('insert into tigeriq_mobile_tasks')){
          insertBoundNode=String(params[6]||'');
          expect(sql).toContain('node_id=$7');
          expect(params[7]).toBe(GATE_C_V020_VERSION);
          return {rowCount:0,rows:[]};
        }
        throw new Error('unexpected client sql: '+sql);
      },
      release(){}
    };
    const pool={
      async query(sql,params=[]){
        if(sql.includes('from tigeriq_mobile_devices')&&sql.includes('agent_version=$1')){
          expect(params).toEqual([GATE_C_V020_VERSION]);
          return {rowCount:1,rows:[{
            node_id:'node-prechecked',employee_id:'NV101',provider:'ChatGPT',
            agent_version:GATE_C_V020_VERSION,last_seen_at:now
          }]};
        }
        throw new Error('unexpected pool sql: '+sql);
      },
      async connect(){return client;}
    };
    const handle=createMobileWorkerApi({pool,coreAuthToken:'core-secret'});
    const req={
      method:'POST',
      headers:{authorization:'Bearer core-secret'},
      socket:{remoteAddress:'127.0.0.1'},
      async *[Symbol.asyncIterator](){}
    };
    const res={writeHead(){},end(){}};
    await expect(handle(req,res,new URL('http://core/api/mobile/gate-c/v020/enqueue')))
      .rejects.toThrow('GATE_C_V020_TARGET_CHANGED');
    expect(insertBoundNode).toBe('node-prechecked');
    expect(rolledBack).toBe(true);
  });

  it('fails closed if the prechecked Gate C v0.21 target changes before insert',async()=>{
    let rolledBack=false;
    let insertBoundNode='';
    const now=new Date().toISOString();
    const client={
      async query(sql,params=[]){
        if(sql==='begin'||sql==='commit')return {rowCount:0,rows:[]};
        if(sql==='rollback'){rolledBack=true;return {rowCount:0,rows:[]};}
        if(sql.startsWith('select pg_advisory_xact_lock'))return {rowCount:1,rows:[{}]};
        if(sql.startsWith('select task_id from tigeriq_mobile_tasks'))return {rowCount:0,rows:[]};
        if(sql.startsWith('insert into tigeriq_mobile_tasks')){
          insertBoundNode=String(params[6]||'');
          expect(sql).toContain('node_id=$7');
          expect(params[7]).toBe(GATE_C_V021_VERSION);
          return {rowCount:0,rows:[]};
        }
        throw new Error('unexpected client sql: '+sql);
      },
      release(){}
    };
    const pool={
      async query(sql,params=[]){
        if(sql.includes('from tigeriq_mobile_devices')&&sql.includes('agent_version=$1')){
          expect(params).toEqual([GATE_C_V021_VERSION]);
          return {rowCount:1,rows:[{
            node_id:'node-prechecked',employee_id:'NV101',provider:'ChatGPT',
            agent_version:GATE_C_V021_VERSION,last_seen_at:now
          }]};
        }
        throw new Error('unexpected pool sql: '+sql);
      },
      async connect(){return client;}
    };
    const handle=createMobileWorkerApi({pool,coreAuthToken:'core-secret'});
    const req={
      method:'POST',
      headers:{authorization:'Bearer core-secret'},
      socket:{remoteAddress:'127.0.0.1'},
      async *[Symbol.asyncIterator](){}
    };
    const res={writeHead(){},end(){}};
    await expect(handle(req,res,new URL('http://core/api/mobile/gate-c/v021/enqueue')))
      .rejects.toThrow('GATE_C_V021_TARGET_CHANGED');
    expect(insertBoundNode).toBe('node-prechecked');
    expect(rolledBack).toBe(true);
  });

  it('reports exact v0.22 live-worker status without enqueueing work',async()=>{
    const now=new Date().toISOString();
    const pool={
      async query(sql,params=[]){
        if(sql.includes('from tigeriq_mobile_devices')&&sql.includes('agent_version=$1')){
          expect(params).toEqual([LIVE_WORKER_VERSION]);
          return {rowCount:1,rows:[{
            node_id:'node-live',employee_id:'NV101',provider:'ChatGPT',
            agent_version:LIVE_WORKER_VERSION,last_seen_at:now,
            update_manifest_seen_at:'2026-10-04T14:00:00.000Z',update_manifest_version:22,
            update_apk_requested_at:'2026-10-04T14:01:00.000Z',update_apk_version:22
          }]};
        }
        throw new Error('unexpected pool sql: '+sql);
      }
    };
    const handle=createMobileWorkerApi({pool,coreAuthToken:'core-secret'});
    const req={method:'GET',headers:{authorization:'Bearer core-secret'},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){}};
    const res={status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
    await handle(req,res,new URL('http://core/api/mobile/live/v022/status'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok:true,status:'MOBILE_LIVE_V022_STATUS',version:LIVE_WORKER_VERSION,
      employeeId:'NV101',online:true,lastSeenAt:now,
      updateManifestSeenAt:'2026-10-04T14:00:00.000Z',updateManifestVersion:22,
      updateApkRequestedAt:'2026-10-04T14:01:00.000Z',updateApkVersion:22
    });
  });

  it('reports version-independent update request telemetry by employee',async()=>{
    const now=new Date().toISOString();
    const pool={async query(sql,params=[]){
      if(sql.includes('from tigeriq_mobile_devices')&&sql.includes('employee_id=$1')){
        expect(params).toEqual(['NV101']);
        return {rowCount:1,rows:[{
          node_id:'node-current',employee_id:'NV101',agent_version:'0.21.0-packageinstaller-stream-fix',
          last_seen_at:now,
          update_manifest_seen_at:'2026-10-04T14:10:00.000Z',update_manifest_version:22,
          update_apk_requested_at:null,update_apk_version:null
        }]};
      }
      throw new Error('unexpected pool sql: '+sql);
    }};
    const handle=createMobileWorkerApi({pool,coreAuthToken:'core-secret'});
    const req={method:'GET',headers:{authorization:'Bearer core-secret'},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){}};
    const res={status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
    await handle(req,res,new URL('http://core/api/mobile/update/request-status?employeeId=NV101'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok:true,status:'MOBILE_UPDATE_REQUEST_STATUS',employeeId:'NV101',
      version:'0.21.0-packageinstaller-stream-fix',online:true,lastSeenAt:now,
      updateManifestSeenAt:'2026-10-04T14:10:00.000Z',updateManifestVersion:22,
      updateApkRequestedAt:null,updateApkVersion:null
    });
  });

  it('records manifest and APK requests from an unchanged authenticated worker',async()=>{
    tempPath=mkdtempSync(join(tmpdir(),'tigeriq-mobile-observe-'));
    const apkPath=join(tempPath,'worker.apk');
    const manifestPath=join(tempPath,'release.json');
    writeFileSync(apkPath,Buffer.alloc(2048,7));
    writeFileSync(manifestPath,JSON.stringify({
      versionCode:22,versionName:'0.22.0-live-worker',sha256:'aa'.repeat(32),
      signerSha256:'11'.repeat(32),fileName:'TIQ Worker v0.22.apk',channel:'STABLE',
      apkPath,publishedAt:'2026-10-04T00:00:00Z'
    }));
    process.env.TIGERIQ_MOBILE_RELEASE_MANIFEST=manifestPath;
    const device={
      node_id:'node-v021',employee_id:'NV101',credential_id:'cred-v021',
      token_hash:createHash('sha256').update('mobile-token').digest('hex'),
      provider:'ChatGPT',department:'Engineering',role:'Android Worker Pilot'
    };
    const observations=[];
    const pool={async query(sql,params=[]){
      if(sql.startsWith('select * from tigeriq_mobile_devices where credential_id=')){
        expect(params).toEqual(['cred-v021']);
        return {rowCount:1,rows:[device]};
      }
      if(sql.startsWith('update tigeriq_mobile_devices set update_')){
        observations.push({sql,params});
        return {rowCount:1,rows:[]};
      }
      throw new Error('unexpected pool sql: '+sql);
    }};
    const handle=createMobileWorkerApi({pool});
    const headers={'x-tigeriq-credential-id':'cred-v021',authorization:'Bearer mobile-token'};

    const manifestReq={method:'GET',headers,socket:{remoteAddress:'100.64.0.9'},async *[Symbol.asyncIterator](){}};
    const manifestRes={status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
    await handle(manifestReq,manifestRes,new URL('http://core/api/mobile/update/manifest'));
    expect(manifestRes.status).toBe(200);
    expect(manifestRes.body).toMatchObject({ok:true,available:true,versionCode:22});
    expect(observations[0].sql).toContain('update_manifest_seen_at=now()');
    expect(observations[0].params).toEqual(['node-v021',22]);

    const apkReq={method:'GET',headers,socket:{remoteAddress:'100.64.0.9'},async *[Symbol.asyncIterator](){}};
    const apkRes=new PassThrough();
    apkRes.status=0;
    apkRes.writeHead=function(status){this.status=status;};
    let apkBytes=0;
    apkRes.on('data',chunk=>{apkBytes+=chunk.length;});
    const finished=new Promise(resolve=>apkRes.on('finish',resolve));
    await handle(apkReq,apkRes,new URL('http://core/api/mobile/update/apk'));
    await finished;
    expect(apkRes.status).toBe(200);
    expect(apkBytes).toBe(2048);
    expect(observations[1].sql).toContain('update_apk_requested_at=now()');
    expect(observations[1].params).toEqual(['node-v021',22]);
  });

  it('surfaces observation-write failure without blocking manifest delivery',async()=>{
    tempPath=mkdtempSync(join(tmpdir(),'tigeriq-mobile-observe-fail-'));
    const apkPath=join(tempPath,'worker.apk');
    const manifestPath=join(tempPath,'release.json');
    writeFileSync(apkPath,Buffer.alloc(2048,7));
    writeFileSync(manifestPath,JSON.stringify({
      versionCode:22,versionName:'0.22.0-live-worker',sha256:'aa'.repeat(32),
      signerSha256:'11'.repeat(32),fileName:'TIQ Worker v0.22.apk',channel:'STABLE',
      apkPath,publishedAt:'2026-10-04T00:00:00Z'
    }));
    process.env.TIGERIQ_MOBILE_RELEASE_MANIFEST=manifestPath;
    const device={
      node_id:'node-v021',employee_id:'NV101',credential_id:'cred-v021',
      token_hash:createHash('sha256').update('mobile-token').digest('hex'),
      provider:'ChatGPT',department:'Engineering',role:'Android Worker Pilot'
    };
    const events=[];
    const pool={async query(sql,params=[]){
      if(sql.startsWith('select * from tigeriq_mobile_devices where credential_id=')){
        return {rowCount:1,rows:[device]};
      }
      if(sql.startsWith('update tigeriq_mobile_devices set update_manifest_seen_at=')){
        expect(sql).toContain('last_seen_at=now()');
        throw new Error('db_temporarily_unavailable');
      }
      throw new Error('unexpected pool sql: '+sql);
    }};
    const handle=createMobileWorkerApi({pool,event:async(type,payload)=>events.push({type,payload})});
    const req={
      method:'GET',
      headers:{'x-tigeriq-credential-id':'cred-v021',authorization:'Bearer mobile-token'},
      socket:{remoteAddress:'100.64.0.9'},
      async *[Symbol.asyncIterator](){}
    };
    const res={status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
    await handle(req,res,new URL('http://core/api/mobile/update/manifest'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ok:true,available:true,versionCode:22});
    expect(events).toEqual([{
      type:'MOBILE_UPDATE_OBSERVATION_FAILED',
      payload:{nodeId:'node-v021',kind:'manifest',versionCode:22,error:'db_temporarily_unavailable'}
    }]);
  });

  it('reports unavailable when no exact v0.22 live worker is enrolled',async()=>{
    const pool={async query(sql,params=[]){
      if(sql.includes('from tigeriq_mobile_devices')&&sql.includes('agent_version=$1')){
        expect(params).toEqual([LIVE_WORKER_VERSION]);
        return {rowCount:0,rows:[]};
      }
      throw new Error('unexpected pool sql: '+sql);
    }};
    const handle=createMobileWorkerApi({pool,coreAuthToken:'core-secret'});
    const req={method:'GET',headers:{authorization:'Bearer core-secret'},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){}};
    const res={status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
    await handle(req,res,new URL('http://core/api/mobile/live/v022/status'));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ok:false,error:'mobile_live_v022_device_unavailable'});
  });

  it('reads a local release manifest without exposing implicit defaults',()=>{
    tempPath=mkdtempSync(join(tmpdir(),'tigeriq-mobile-'));
    const path=join(tempPath,'release.json');
    writeFileSync(path,JSON.stringify({
      versionCode:7,versionName:'0.7.0-core-mobile',sha256:'aa'.repeat(32),
      signerSha256:'11:22',fileName:'TIQ Worker v0.7.apk',channel:'DEV',
      apkPath:'D:\\TigerIQ\\Releases\\AndroidWorker\\TIQ Worker v0.7.apk',
      driveUrl:'https://drive.google.com/file/d/test/view',publishedAt:'2026-10-03T00:00:00Z'
    }));
    const manifest=readMobileReleaseManifest(path);
    expect(manifest.available).toBe(true);
    expect(manifest.versionCode).toBe(7);
    expect(manifest.downloadPath).toBe('/api/mobile/update/apk');
    expect(manifest.driveUrl).toContain('drive.google.com');
  });
});
