import {createPublicKey,verify as verifySignature} from 'node:crypto';

const ISSUER='https://token.actions.githubusercontent.com';
const AUDIENCE='tigeriq-core';
const REPOSITORY='newsdayads/tigeriq-ai-lab';
const WORKFLOW='newsdayads/tigeriq-ai-lab/.github/workflows/tigeriq-core-event-dispatch.yml@refs/heads/main';
let oidcConfigCache={at:0,value:null};
let jwksCache={at:0,value:null};
const CACHE_MS=60*60*1000;

function decodePart(part){
  const value=String(part);
  return Buffer.from(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='),'base64');
}
function parseJsonPart(part,label){
  try{return JSON.parse(decodePart(part).toString('utf8'))}catch{throw new Error(`GITHUB_OIDC_${label}_INVALID`)}
}
function includesAudience(aud){
  return Array.isArray(aud)?aud.includes(AUDIENCE):String(aud||'')===AUDIENCE;
}

export function validateGithubActionsClaims(claims={},nowMs=Date.now()){
  const now=Math.floor(nowMs/1000);
  if(claims.iss!==ISSUER)throw new Error('GITHUB_OIDC_ISSUER_INVALID');
  if(!includesAudience(claims.aud))throw new Error('GITHUB_OIDC_AUDIENCE_INVALID');
  if(String(claims.repository||'')!==REPOSITORY)throw new Error('GITHUB_OIDC_REPOSITORY_INVALID');
  if(String(claims.repository_owner||'')!=='newsdayads')throw new Error('GITHUB_OIDC_OWNER_INVALID');
  if(Number(claims.exp||0)<=now-30)throw new Error('GITHUB_OIDC_EXPIRED');
  if(Number(claims.nbf||0)>now+30)throw new Error('GITHUB_OIDC_NOT_YET_VALID');
  const workflowRef=String(claims.job_workflow_ref||claims.workflow_ref||'');
  if(workflowRef!==WORKFLOW)throw new Error('GITHUB_OIDC_WORKFLOW_INVALID');
  if(String(claims.ref||'')!=='refs/heads/main')throw new Error('GITHUB_OIDC_REF_INVALID');
  return {repository:REPOSITORY,workflowRef,runId:String(claims.run_id||''),actor:String(claims.actor||'')};
}

async function oidcConfig(fetchImpl){
  if(oidcConfigCache.value&&Date.now()-oidcConfigCache.at<CACHE_MS)return oidcConfigCache.value;
  const response=await fetchImpl(`${ISSUER}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`GITHUB_OIDC_DISCOVERY_HTTP_${response.status}`);
  const value=await response.json();
  if(value.issuer!==ISSUER||!String(value.jwks_uri||'').startsWith(ISSUER+'/'))throw new Error('GITHUB_OIDC_DISCOVERY_INVALID');
  oidcConfigCache={at:Date.now(),value};return value;
}
async function jwks(fetchImpl){
  if(jwksCache.value&&Date.now()-jwksCache.at<CACHE_MS)return jwksCache.value;
  const config=await oidcConfig(fetchImpl);
  const response=await fetchImpl(config.jwks_uri,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`GITHUB_OIDC_JWKS_HTTP_${response.status}`);
  const value=await response.json();
  if(!Array.isArray(value.keys))throw new Error('GITHUB_OIDC_JWKS_INVALID');
  jwksCache={at:Date.now(),value};return value;
}

export async function verifyGithubActionsOidc(token,fetchImpl=fetch){
  const parts=String(token||'').split('.');
  if(parts.length!==3)throw new Error('GITHUB_OIDC_TOKEN_INVALID');
  const header=parseJsonPart(parts[0],'HEADER');
  const claims=parseJsonPart(parts[1],'CLAIMS');
  if(header.alg!=='RS256'||!header.kid)throw new Error('GITHUB_OIDC_ALG_INVALID');
  const set=await jwks(fetchImpl);
  const jwk=set.keys.find(key=>key.kid===header.kid&&(!key.alg||key.alg==='RS256'));
  if(!jwk){jwksCache={at:0,value:null};throw new Error('GITHUB_OIDC_KEY_NOT_FOUND')}
  const key=createPublicKey({key:jwk,format:'jwk'});
  const signed=Buffer.from(parts[0]+'.'+parts[1]);
  const signature=decodePart(parts[2]);
  if(!verifySignature('RSA-SHA256',signed,key,signature))throw new Error('GITHUB_OIDC_SIGNATURE_INVALID');
  return {...validateGithubActionsClaims(claims),claims};
}
