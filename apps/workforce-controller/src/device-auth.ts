import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import type { SqlPoolLike } from '../../../packages/work-state/src/postgres-repository.js';

export interface DeviceAuthRequest {
  method:string;
  path:string;
  headers:Record<string,string|undefined>;
  body:Buffer;
  nowMs?:number;
}

export interface DeviceAuthContext {
  employeeId:string;
  nodeId:string;
  deviceId:string;
  bindingId:string;
  capabilities:string[];
  permissions:string[];
  publicKeyFingerprint:string;
}

export class DeviceAuthError extends Error {
  constructor(readonly status:number, readonly code:string, message:string, readonly retryable=false){super(message);}
}

const PROOF_VERSION='1';
const DEFAULT_MAX_SKEW_MS=60_000;
const REPLAY_CLEANUP_BATCH=1_000;
const MAX_NODE_ID_LENGTH=128;

function sha256Bytes(value:Buffer|string):string{return createHash('sha256').update(value).digest('hex');}
function requiredHeader(headers:Record<string,string|undefined>,name:string):string{
  const value=headers[name.toLowerCase()]?.trim();
  if(!value)throw new DeviceAuthError(401,'DEVICE_PROOF_MISSING',`missing ${name}`);
  return value;
}
function timingSafeTextEqual(left:string,right:string):boolean{
  const a=Buffer.from(left,'utf8'),b=Buffer.from(right,'utf8');
  return a.length===b.length&&timingSafeEqual(a,b);
}

export class VerifiedDeviceAuthenticator {
  constructor(private readonly pool:SqlPoolLike,private readonly maxSkewMs=DEFAULT_MAX_SKEW_MS){}

  async verify(request:DeviceAuthRequest):Promise<DeviceAuthContext>{
    const headers=Object.fromEntries(Object.entries(request.headers).map(([k,v])=>[k.toLowerCase(),v]));
    if(requiredHeader(headers,'X-TigerIQ-Device-Proof-V')!==PROOF_VERSION)throw new DeviceAuthError(401,'DEVICE_PROOF_VERSION','unsupported device proof version');
    const employeeId=requiredHeader(headers,'X-TigerIQ-Employee-Id');
    const nodeId=requiredHeader(headers,'X-TigerIQ-Node-Id');
    const deviceId=requiredHeader(headers,'X-TigerIQ-Device-Id');
    const claimedFingerprint=requiredHeader(headers,'X-TigerIQ-Device-Key-Fingerprint').toLowerCase();
    const publicKeyBase64=requiredHeader(headers,'X-TigerIQ-Device-Public-Key');
    const timestampText=requiredHeader(headers,'X-TigerIQ-Device-Timestamp');
    const nonce=requiredHeader(headers,'X-TigerIQ-Device-Nonce');
    const challenge=requiredHeader(headers,'X-TigerIQ-Device-Challenge').toLowerCase();
    const signature=requiredHeader(headers,'X-TigerIQ-Device-Signature');
    if(nodeId.length>MAX_NODE_ID_LENGTH)throw new DeviceAuthError(401,'DEVICE_NODE_ID_INVALID','device node id is too long');
    if(!/^[a-f0-9]{64}$/.test(claimedFingerprint))throw new DeviceAuthError(401,'DEVICE_FINGERPRINT_INVALID','invalid device key fingerprint');
    const timestamp=Number(timestampText),now=request.nowMs??Date.now();
    if(!Number.isSafeInteger(timestamp)||Math.abs(now-timestamp)>this.maxSkewMs)throw new DeviceAuthError(401,'DEVICE_PROOF_EXPIRED','device proof timestamp outside allowed skew');
    if(nonce.length<16||nonce.length>128)throw new DeviceAuthError(401,'DEVICE_NONCE_INVALID','invalid device nonce');

    const rows=await this.pool.query<{
      employee_id:string;device_id:string;binding_id:string;permissions:string[];capabilities:string[];
      public_key_fingerprint:string|null;metadata:Record<string,unknown>;
    }>(`SELECT e.employee_id,d.device_id,b.binding_id,e.permissions,e.capabilities,d.public_key_fingerprint,d.metadata
        FROM employees e
        JOIN employee_device_bindings b ON b.employee_id=e.employee_id AND b.state='active'
        JOIN devices d ON d.device_id=b.device_id AND d.state='active'
        WHERE e.employee_id=$1 AND d.device_id=$2 AND e.state='active'
        ORDER BY b.updated_at DESC LIMIT 1`,[employeeId,deviceId]);
    const row=rows.rows[0];
    if(!row)throw new DeviceAuthError(401,'DEVICE_BINDING_INACTIVE','active employee/device binding required');
    const storedFingerprint=(row.public_key_fingerprint??'').toLowerCase();
    const storedPublicKey=typeof row.metadata?.publicKeyBase64==='string'?String(row.metadata.publicKeyBase64):'';
    const storedNodeId=typeof row.metadata?.nodeId==='string'?String(row.metadata.nodeId).trim():'';
    if(!storedFingerprint||!storedPublicKey)throw new DeviceAuthError(401,'DEVICE_KEY_NOT_PROVISIONED','device public key is not provisioned');
    if(!storedNodeId)throw new DeviceAuthError(401,'DEVICE_NODE_NOT_PROVISIONED','device node id is not provisioned');
    if(!timingSafeTextEqual(storedNodeId,nodeId))throw new DeviceAuthError(401,'DEVICE_NODE_ID_MISMATCH','device node id does not match provisioned identity');
    if(!timingSafeTextEqual(storedFingerprint,claimedFingerprint))throw new DeviceAuthError(401,'DEVICE_FINGERPRINT_MISMATCH','device key fingerprint mismatch');
    if(!timingSafeTextEqual(storedPublicKey,publicKeyBase64))throw new DeviceAuthError(401,'DEVICE_PUBLIC_KEY_MISMATCH','device public key mismatch');

    let publicKeyDer:Buffer;
    try{publicKeyDer=Buffer.from(publicKeyBase64,'base64');}catch{throw new DeviceAuthError(401,'DEVICE_PUBLIC_KEY_INVALID','invalid device public key');}
    if(sha256Bytes(publicKeyDer)!==storedFingerprint)throw new DeviceAuthError(401,'DEVICE_FINGERPRINT_INVALID','device public key does not match fingerprint');
    const bodyHash=sha256Bytes(request.body);
    const canonical=`${request.method.toUpperCase()}\n${request.path}\n${employeeId}\n${nodeId}\n${deviceId}\n${timestampText}\n${nonce}\n${bodyHash}`;
    const computedChallenge=sha256Bytes(canonical);
    if(!timingSafeTextEqual(computedChallenge,challenge))throw new DeviceAuthError(401,'DEVICE_CHALLENGE_MISMATCH','device challenge mismatch');
    try{
      const key=createPublicKey({key:publicKeyDer,format:'der',type:'spki'});
      const ok=verifySignature('sha256',Buffer.from(canonical,'utf8'),key,Buffer.from(signature,'base64url'));
      if(!ok)throw new DeviceAuthError(401,'DEVICE_SIGNATURE_INVALID','device signature invalid');
    }catch(error){
      if(error instanceof DeviceAuthError)throw error;
      throw new DeviceAuthError(401,'DEVICE_SIGNATURE_INVALID','device signature invalid');
    }

    await this.claimNonce(deviceId,nonce,timestamp,now);
    return {employeeId:row.employee_id,nodeId:storedNodeId,deviceId:row.device_id,bindingId:row.binding_id,capabilities:row.capabilities??[],permissions:row.permissions??[],publicKeyFingerprint:storedFingerprint};
  }

  private async claimNonce(deviceId:string,nonce:string,proofTimestampMs:number,acceptedAtMs:number):Promise<void>{
    const client=await this.pool.connect();
    const acceptedAt=new Date(acceptedAtMs).toISOString();
    const proofTimestamp=new Date(proofTimestampMs).toISOString();
    const retentionMs=Math.max((this.maxSkewMs*2)+1_000,1_000);
    const expiresAt=new Date(acceptedAtMs+retentionMs).toISOString();
    try{
      await client.query('BEGIN');
      await client.query(`DELETE FROM device_proof_replay_state
        WHERE ctid IN (
          SELECT ctid FROM device_proof_replay_state
          WHERE expires_at <= $1
          ORDER BY expires_at
          LIMIT $2
        )`,[acceptedAt,REPLAY_CLEANUP_BATCH]);
      const claimed=await client.query<{device_id:string}>(`INSERT INTO device_proof_replay_state
        (device_id,nonce,proof_timestamp,accepted_at,expires_at)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (device_id,nonce) DO NOTHING
        RETURNING device_id`,[deviceId,nonce,proofTimestamp,acceptedAt,expiresAt]);
      if(!claimed.rows[0])throw new DeviceAuthError(409,'DEVICE_PROOF_REPLAY','device proof nonce already used');
      await client.query('COMMIT');
    }catch(error){
      try{await client.query('ROLLBACK');}catch{}
      throw error;
    }finally{client.release();}
  }
}
