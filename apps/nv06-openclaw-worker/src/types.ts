import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const NV06_EMPLOYEE_ID='EMP-NV06-OPENCLAW';
export const NV06_DEVICE_ID='DEV-PC01-NV06-OPENCLAW';
export const NV06_BINDING_ID='BIND-NV06-OPENCLAW';
export const NV06_NODE_ID='PC01-NV06';
export const NV06_CAPABILITIES=['browser.chatgpt','continuity.signal','openclaw','evidence'] as const;
export const NV06_PERMISSIONS=['browser:execute','evidence:write'] as const;

export interface WorkerJob {
  jobId:string; title:string; objective:string; payload:Record<string,unknown>;
  requiredCapabilities:string[]; requiredPermissions:string[];
  expectedEvidence:('text'|'json'|'log'|'commit'|'url'|'screenshot')[];
  independentReview:boolean; judgeRequired:boolean;
}
export interface WorkerLease { leaseId:string; leaseToken:string; expiresAt:string; job:WorkerJob; }
export interface Identity { employeeId:string;deviceId:string;bindingId:string;nodeId:string;publicKeyBase64:string;publicKeyFingerprint:string;privateKeyPem:string; }
export interface NV06Config { controllerUrl:string;ingressToken:string;identityFile:string;workspace:string;openclawCli:string;openclawHome:string;openclawStateDir:string;openclawConfigPath:string;openclawWorkspaceDir:string;pollMs:number;heartbeatMs:number;timeoutSeconds:number; }

export function sha256(value:Buffer|string):string{return createHash('sha256').update(value).digest('hex');}
export function sleep(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}
export function asRecord(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
export function stringValue(value:unknown):string|undefined{return typeof value==='string'&&value.trim()?value.trim():undefined;}
export async function loadOrCreateIdentity(identityFile:string):Promise<Identity>{
  try{const parsed=JSON.parse(await readFile(identityFile,'utf8')) as Identity;if(parsed.privateKeyPem&&parsed.publicKeyBase64&&parsed.publicKeyFingerprint)return parsed;}catch{}
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1',publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const identity:Identity={employeeId:NV06_EMPLOYEE_ID,deviceId:NV06_DEVICE_ID,bindingId:NV06_BINDING_ID,nodeId:NV06_NODE_ID,publicKeyBase64:pair.publicKey.toString('base64'),publicKeyFingerprint:sha256(pair.publicKey),privateKeyPem:pair.privateKey};
  await mkdir(path.dirname(identityFile),{recursive:true});const tmp=`${identityFile}.tmp`;await writeFile(tmp,JSON.stringify(identity,null,2),'utf8');await rename(tmp,identityFile);return identity;
}

function runtimeSecret(file:string):string{try{return readFileSync(file,'utf8').trim();}catch{return '';}}
export function configFromEnv():NV06Config{
  const ingressToken=(process.env.TIGERIQ_INGRESS_TOKEN??runtimeSecret('D:\\TigerIQ\\Secrets\\pc01-primary-node.ingress-token')).trim();
  if(ingressToken.length<32)throw new Error('TIGERIQ_INGRESS_TOKEN must contain at least 32 characters');
  const stateRoot=process.env.TIGERIQ_NV06_STATE_DIR?.trim()||'D:\\TigerIQ\\Runtime\\nv06-openclaw-worker\\state';
  return {
    controllerUrl:process.env.TIGERIQ_CONTROLLER_URL?.trim()||'http://100.97.23.87:8790', ingressToken,
    identityFile:path.join(stateRoot,'identity.json'), workspace:path.resolve(process.env.TIGERIQ_WORKSPACE?.trim()||'D:\\TigerIQ\\Workspace\\tigeriq-ai-lab'),
    openclawCli:process.env.TIGERIQ_OPENCLAW_CLI?.trim()||'D:\\OpenClaw\\npm-global\\openclaw.cmd', openclawHome:'D:\\OpenClaw',
    openclawStateDir:'D:\\TigerIQ-OpenClaw\\state', openclawConfigPath:'D:\\TigerIQ-OpenClaw\\state\\openclaw.json', openclawWorkspaceDir:'D:\\TigerIQ-OpenClaw\\workspace',
    pollMs:Math.max(500,Number(process.env.TIGERIQ_NV06_POLL_MS??1500)), heartbeatMs:Math.max(5000,Number(process.env.TIGERIQ_NV06_HEARTBEAT_MS??15000)),
    timeoutSeconds:Math.min(600,Math.max(60,Number(process.env.TIGERIQ_NV06_TIMEOUT_SECONDS??240)))
  };
}
