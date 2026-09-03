import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VerifiedDeviceAuthenticator } from '../apps/workforce-controller/src/device-auth.js';
import type { SqlClientLike, SqlPoolLike, SqlQueryResult } from '../packages/work-state/src/postgres-repository.js';

function sha256(value:Buffer|string):string{return createHash('sha256').update(value).digest('hex');}

describe('Controller device proof node binding',()=>{
  const employeeId='EMP-NODE-001';
  const deviceId='DEV-NODE-001';
  const bindingId='BIND-NODE-001';
  const provisionedNodeId='NODE-PROVISIONED-001';
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const publicKeyDer=keys.publicKey.export({format:'der',type:'spki'}) as Buffer;
  const publicKeyBase64=publicKeyDer.toString('base64');
  const fingerprint=sha256(publicKeyDer);

  function signedRequest(nodeId:string,nowMs=Date.now()){
    const method='POST',path='/api/v1/jobs/lease',body=Buffer.from('{"leaseTtlMs":60000}','utf8');
    const timestamp=String(nowMs);
    const nonce=`node-binding-${nowMs}`;
    const canonical=`${method}\n${path}\n${employeeId}\n${nodeId}\n${deviceId}\n${timestamp}\n${nonce}\n${sha256(body)}`;
    return {method,path,body,nowMs,headers:{
      'x-tigeriq-device-proof-v':'1',
      'x-tigeriq-employee-id':employeeId,
      'x-tigeriq-node-id':nodeId,
      'x-tigeriq-device-id':deviceId,
      'x-tigeriq-device-key-fingerprint':fingerprint,
      'x-tigeriq-device-public-key':publicKeyBase64,
      'x-tigeriq-device-timestamp':timestamp,
      'x-tigeriq-device-nonce':nonce,
      'x-tigeriq-device-challenge':sha256(canonical),
      'x-tigeriq-device-signature':sign('sha256',Buffer.from(canonical,'utf8'),keys.privateKey).toString('base64url'),
    }};
  }

  function poolWithMetadata(metadata:Record<string,unknown>){
    let connectCalls=0;
    const pool:SqlPoolLike={
      async query<Row=Record<string,unknown>>(_text:string,_values?:readonly unknown[]):Promise<SqlQueryResult<Row>>{
        return {rows:[{
          employee_id:employeeId,device_id:deviceId,binding_id:bindingId,
          permissions:['jobs:lease'],capabilities:['ai-direct'],public_key_fingerprint:fingerprint,metadata,
        }] as unknown as Row[]};
      },
      async connect():Promise<SqlClientLike>{
        connectCalls+=1;
        throw new Error('nonce claim must not run for rejected node identity');
      },
    };
    return {pool,getConnectCalls:()=>connectCalls};
  }

  it('rejects a cryptographically valid proof when the signed node id differs from provisioning',async()=>{
    const fake=poolWithMetadata({publicKeyBase64,nodeId:provisionedNodeId});
    const auth=new VerifiedDeviceAuthenticator(fake.pool);
    const request=signedRequest('NODE-IMPOSTOR-999');
    await expect(auth.verify(request)).rejects.toMatchObject({status:401,code:'DEVICE_NODE_ID_MISMATCH'});
    expect(fake.getConnectCalls()).toBe(0);
  });

  it('fails closed when a device key exists but no node identity was provisioned',async()=>{
    const fake=poolWithMetadata({publicKeyBase64});
    const auth=new VerifiedDeviceAuthenticator(fake.pool);
    await expect(auth.verify(signedRequest(provisionedNodeId))).rejects.toMatchObject({status:401,code:'DEVICE_NODE_NOT_PROVISIONED'});
    expect(fake.getConnectCalls()).toBe(0);
  });
});
