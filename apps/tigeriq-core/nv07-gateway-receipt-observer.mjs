import { readFileSync } from 'node:fs';

const RECEIPTS=Object.freeze([
  {version:'V1',schema:'NV07_GATEWAY_CANARY_V1',path:String.raw`D:\TigerIQ\State\NV07\gateway-read-metadata-once.json`},
  {version:'V2',schema:'NV07_GATEWAY_CANARY_V2',path:String.raw`D:\TigerIQ\State\NV07\gateway-read-metadata-v2.json`},
  {version:'V3',schema:'NV07_GATEWAY_CANARY_V3',path:String.raw`D:\TigerIQ\State\NV07\gateway-read-metadata-v3.json`},
]);
const VALID_HASH=/^[a-f0-9]{64}$/i;
const VALID_JOB=/^NV07-4783-GW-[A-Z0-9-]{6,80}$/;
const DENIAL=Object.freeze({available:false,accepted:false,code:'NOT_VERIFIED'});

// Parse only the named metadata fields of a fixed local, one-shot receipt.
// Never return model text, prompt, CLI stdout/stderr, credentials, or file
// content; the returned object is safe for a read-only Core status response.
export function projectNv07GatewayCanaryEvidence(raw,version,nowMs=Date.now()){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {...DENIAL,version};
  const declaration=RECEIPTS.find(x=>x.version===version);
  if(!declaration||raw.schema!==declaration.schema
    ||typeof raw.jobId!=='string'||!VALID_JOB.test(raw.jobId))
    return {...DENIAL,version,code:'RECEIPT_CONTRACT_INVALID'};
  const started=Date.parse(raw.startedAt),ended=Date.parse(raw.completedAt);
  const finished=Number.isFinite(ended)&&Number.isFinite(started)
    &&ended>=started&&ended<=nowMs+300000;
  const hash=typeof raw.outputHash==='string'&&VALID_HASH.test(raw.outputHash)
    ?raw.outputHash.toLowerCase():null;
  const accepted=raw.accepted===true
    &&raw.state==='GATEWAY_USER_CLI_JSON_VERIFIED_NOT_CORE_LEASE'
    &&raw.reason==='NV07_READ_METADATA_TRANSPORT_OK'
    &&raw.exitCode===0&&raw.timedOut===false
    &&raw.coreLeaseVerified===false&&raw.nv07Active===false
    &&finished&&Boolean(hash);
  const completed=raw.accepted===false
    &&raw.state==='GATEWAY_CANARY_FAILED'&&finished;
  const inProgress=raw.state==='STARTED_NOT_ACCEPTED'
    &&Number.isFinite(started)&&started<=nowMs+300000
    &&nowMs-started<90000;
  return Object.freeze({
    version,
    available:true,
    status:accepted?'PASSED_GATEWAY_ONLY':completed?'FAILED':
      inProgress?'STARTED_NOT_ACCEPTED':'NOT_VERIFIED',
    accepted,
    jobId:raw.jobId,
    startedAt:Number.isFinite(started)?new Date(started).toISOString():null,
    completedAt:finished?new Date(ended).toISOString():null,
    durationMs:finished?ended-started:null,
    outputHash:hash,
    tokens:Number.isSafeInteger(raw.totalTokens)&&raw.totalTokens>=0
      ?raw.totalTokens:null,
    proposedFileCount:Number.isSafeInteger(raw.proposedFileCount)
      &&raw.proposedFileCount>=0?raw.proposedFileCount:null,
    exitCode:Number.isInteger(raw.exitCode)?raw.exitCode:null,
    // A Gateway receipt is NEVER evidence of a Core DB lease or ACTIVE state.
    coreLeaseVerified:false,nv07Active:false,
  });
}

export function readNv07GatewayCanarySnapshot({
  read=readFileSync, nowMs=Date.now(),
}={}){
  const canaries=RECEIPTS.map(spec=>{
    try{
      const data=JSON.parse(read(spec.path,'utf8'));
      return projectNv07GatewayCanaryEvidence(data,spec.version,nowMs);
    }catch{return Object.freeze({...DENIAL,version:spec.version});}
  });
  const acceptedCanary=canaries.filter(x=>x.accepted===true).at(-1)||null;
  return Object.freeze({
    code:acceptedCanary?'NV07_GATEWAY_TRANSPORT_VERIFIED':'NV07_GATEWAY_TRANSPORT_NOT_VERIFIED',
    gatewayTransportVerified:Boolean(acceptedCanary),
    latestAcceptedVersion:acceptedCanary?.version||null,
    coreLeaseVerified:false,
    nv07Active:false,
    state:'PROVISIONING_NOT_ROUTABLE',
    canaries:Object.freeze(canaries),
  });
}
