import { afterEach, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATE_C_V020_COUNT, GATE_C_V020_VERSION, GATE_C_V021_COUNT, GATE_C_V021_VERSION, createMobileWorkerApi, gateCV020Aggregate, gateCV020TaskSpecs, gateCV021Aggregate, gateCV021TaskSpecs, mobileTaskLeaseFresh, mobileTaskResultDigest, mobileTaskTerminalDecision, normalizeMobileProvider, readMobileReleaseManifest, verifyCoreEnqueueAuth, verifyMobilePairingProof } from './mobile-worker-api.mjs';

let tempPath='';
afterEach(()=>{if(tempPath)rmSync(tempPath,{recursive:true,force:true});tempPath='';});

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
      result:{output:{validatedToken:spec.expectedToken,sendCount:1,duplicateSendCount:0}},
    }));
    expect(gateCV021Aggregate(rows,'NV101')).toMatchObject({expected:10,taskCount:10,completed:10,failed:0,pending:0,invalid:0,pass:true});
    rows[4].result.output.duplicateSendCount=1;
    expect(gateCV021Aggregate(rows,'NV101')).toMatchObject({completed:10,invalid:1,pass:false});
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
