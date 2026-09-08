import { createPrivateKey, randomBytes, sign as signPayload } from 'node:crypto';
import { asRecord, PC01_CAPABILITIES, PC01_PERMISSIONS, sha256, stringValue, type Identity, type WorkerLease } from './types.js';

export class ControllerClient {
  constructor(readonly baseUrl:string,readonly ingressToken:string,readonly identity:Identity){}
  async register(metadata:Record<string,unknown>):Promise<Record<string,unknown>>{
    return this.request('/api/v1/pc01/register',{employeeId:this.identity.employeeId,deviceId:this.identity.deviceId,bindingId:this.identity.bindingId,nodeId:this.identity.nodeId,displayName:'PC01 Native Worker',platform:'windows-pc01',publicKeyBase64:this.identity.publicKeyBase64,publicKeyFingerprint:this.identity.publicKeyFingerprint,capabilities:[...PC01_CAPABILITIES],permissions:[...PC01_PERMISSIONS],concurrencyLimit:4,metadata},{Authorization:`Bearer ${this.ingressToken}`});
  }
  async heartbeat(snapshot:Record<string,unknown>,health:'ok'|'degraded'='ok'):Promise<void>{await this.signed(`/api/v1/devices/${encodeURIComponent(this.identity.deviceId)}/heartbeat`,{health,metadata:snapshot});}
  async lease():Promise<WorkerLease|undefined>{const body=await this.signed('/api/v1/jobs/lease',{leaseTtlMs:120_000});return (body.lease??undefined) as WorkerLease|undefined;}
  async renew(lease:WorkerLease):Promise<void>{await this.signed(`/api/v1/jobs/${encodeURIComponent(lease.job.jobId)}/lease/renew`,{leaseId:lease.leaseId,leaseToken:lease.leaseToken,leaseTtlMs:120_000});}
  async submit(lease:WorkerLease,result:Record<string,unknown>):Promise<Record<string,unknown>>{return this.signed(`/api/v1/jobs/${encodeURIComponent(lease.job.jobId)}/result`,{leaseId:lease.leaseId,leaseToken:lease.leaseToken,result});}
  private async signed(resource:string,body:Record<string,unknown>):Promise<Record<string,unknown>>{
    const raw=JSON.stringify(body),rawBytes=Buffer.from(raw,'utf8'),timestamp=String(Date.now()),nonce=randomBytes(16).toString('hex'),bodyHash=sha256(rawBytes),canonical=`POST\n${resource}\n${this.identity.employeeId}\n${this.identity.nodeId}\n${this.identity.deviceId}\n${timestamp}\n${nonce}\n${bodyHash}`,challenge=sha256(canonical),signature=signPayload('sha256',Buffer.from(canonical,'utf8'),createPrivateKey(this.identity.privateKeyPem)).toString('base64url');
    return this.requestRaw(resource,raw,{'X-TigerIQ-Device-Proof-V':'1','X-TigerIQ-Employee-Id':this.identity.employeeId,'X-TigerIQ-Node-Id':this.identity.nodeId,'X-TigerIQ-Device-Id':this.identity.deviceId,'X-TigerIQ-Device-Key-Fingerprint':this.identity.publicKeyFingerprint,'X-TigerIQ-Device-Public-Key':this.identity.publicKeyBase64,'X-TigerIQ-Device-Timestamp':timestamp,'X-TigerIQ-Device-Nonce':nonce,'X-TigerIQ-Device-Challenge':challenge,'X-TigerIQ-Device-Signature':signature});
  }
  private request(resource:string,body:Record<string,unknown>,headers:Record<string,string>):Promise<Record<string,unknown>>{return this.requestRaw(resource,JSON.stringify(body),headers);}
  private async requestRaw(resource:string,raw:string,headers:Record<string,string>):Promise<Record<string,unknown>>{
    const response=await fetch(new URL(resource,this.baseUrl),{method:'POST',headers:{'Content-Type':'application/json',...headers},body:raw});const parsed=await response.json() as Record<string,unknown>;
    if(!response.ok){const error=asRecord(parsed.error);throw new Error(`${stringValue(error?.code)??`HTTP_${response.status}`}:${stringValue(error?.message)??'controller request failed'}`);}return parsed;
  }
}
