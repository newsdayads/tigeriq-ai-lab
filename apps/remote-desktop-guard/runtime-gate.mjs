import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AUTHORIZATION_TOOL, DEFAULT_LEASE_PATH, OBSERVATION_DIRECTORIES, READ_ONLY_TOOLS, authorizeRemoteCall, classifyTool, validateLeaseEnvelope
} from './policy.mjs';

const OWNER_LOGIN='newsdayads';
const OWNER_AUTH_MARKER='TIGERIQ_REMOTE_MUTATION_AUTH_V1';

const AUTHORIZATION_TOOL_DEFINITION=Object.freeze({
  name:AUTHORIZATION_TOOL,
  description:'Install one exact, bounded TigerIQ mutation lease from a verified Owner GitHub authorization record. This tool cannot execute the mutation itself.',
  inputSchema:{
    type:'object',
    properties:{authorizationUrl:{type:'string'}},
    required:['authorizationUrl'],
    additionalProperties:false,
  },
  annotations:{title:'Authorize one bounded TigerIQ mutation',readOnlyHint:false,destructiveHint:false,openWorldHint:true},
});

function denial(reason,extra={}) { return {ok:false,reason,...extra}; }

function parseAuthRecord(body='') {
  const lines=String(body).split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);
  if (!lines.includes(OWNER_AUTH_MARKER)) return null;
  const record={};
  for (const line of lines) {
    const index=line.indexOf('=');
    if (index<=0) continue;
    record[line.slice(0,index)]=line.slice(index+1);
  }
  return record;
}

function leaseFromAuthorizationRecord(record,authorizationUrl) {
  if (!record) return null;
  return {
    version:1,
    leaseId:String(record.LEASE_ID||''),
    ownerAuthorized:record.OWNER_AUTHORIZED==='true',
    authorizationUrl,
    tool:String(record.TOOL||''),
    argsSha256:String(record.ARGS_SHA256||''),
    riskClass:String(record.RISK_CLASS||''),
    issuedAt:String(record.ISSUED_AT||''),
    expiresAt:String(record.EXPIRES_AT||''),
  };
}

async function fetchOwnerAuthorizationRecord(authorizationUrl,{fetchImpl=globalThis.fetch}={}) {
  if (typeof authorizationUrl!=='string' || !/^https:\/\/api\.github\.com\/repos\/newsdayads\/tigeriq-ai-lab\/issues\/comments\/\d+$/.test(authorizationUrl)) return denial('OWNER_AUTH_REF_INVALID');
  if (typeof fetchImpl!=='function') return denial('OWNER_AUTH_VERIFY_UNAVAILABLE');
  try {
    const response=await fetchImpl(authorizationUrl,{
      method:'GET',
      headers:{Accept:'application/vnd.github+json','User-Agent':'TigerIQ-Remote-Guard/1'}
    });
    if (!response?.ok) return denial('OWNER_AUTH_VERIFY_HTTP_'+String(response?.status??'ERR'));
    const data=await response.json();
    if (data?.user?.login!==OWNER_LOGIN) return denial('OWNER_AUTH_AUTHOR_MISMATCH');
    const record=parseAuthRecord(data?.body);
    if (!record || record.OWNER_AUTHORIZED!=='true') return denial('OWNER_AUTH_RECORD_INVALID');
    return {ok:true,reason:'OWNER_AUTH_REF_VERIFIED',record};
  } catch {
    return denial('OWNER_AUTH_VERIFY_FAILED');
  }
}

export async function installOwnerLeaseFromAuthorization({authorizationUrl}={},{
  fetchImpl=globalThis.fetch,leasePath=DEFAULT_LEASE_PATH,now=Date.now()
}={}) {
  const verified=await fetchOwnerAuthorizationRecord(authorizationUrl,{fetchImpl});
  if (!verified.ok) return verified;
  const lease=leaseFromAuthorizationRecord(verified.record,authorizationUrl);
  const envelope=validateLeaseEnvelope(lease,{now});
  if (!envelope.ok) return envelope;
  const selfCheck=await verifyOwnerAuthorizationRef(lease,{fetchImpl});
  if (!selfCheck.ok) return selfCheck;
  try {
    await mkdir(path.dirname(leasePath),{recursive:true});
    await writeFile(leasePath,JSON.stringify(lease,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  } catch(error) {
    if (error?.code==='EEXIST') return denial('ACTIVE_LEASE_EXISTS');
    return denial('LEASE_INSTALL_FAILED');
  }
  return {ok:true,reason:'OWNER_LEASE_INSTALLED',leaseId:lease.leaseId,tool:lease.tool,expiresAt:lease.expiresAt};
}

export async function verifyOwnerAuthorizationRef(lease,{fetchImpl=globalThis.fetch}={}) {
  const verified=await fetchOwnerAuthorizationRecord(lease?.authorizationUrl,{fetchImpl});
  if (!verified.ok) return verified;
  const record=verified.record;
  if (record.LEASE_ID !== lease.leaseId) return denial('OWNER_AUTH_LEASE_MISMATCH');
  if (record.TOOL !== lease.tool) return denial('OWNER_AUTH_TOOL_MISMATCH');
  if (record.ARGS_SHA256 !== lease.argsSha256) return denial('OWNER_AUTH_ARGS_MISMATCH');
  if (record.RISK_CLASS !== lease.riskClass) return denial('OWNER_AUTH_RISK_MISMATCH');
  if (record.ISSUED_AT !== lease.issuedAt || record.EXPIRES_AT !== lease.expiresAt) return denial('OWNER_AUTH_TIME_MISMATCH');
  return {ok:true,reason:'OWNER_AUTH_REF_VERIFIED'};
}

async function claimLease(leasePath,now) {
  const claimPath=leasePath+'.claim-'+process.pid+'-'+now;
  try { await rename(leasePath,claimPath); }
  catch(error) {
    if (error?.code === 'ENOENT') return {ok:false,reason:'OWNER_AUTH_REQUIRED'};
    return {ok:false,reason:'LEASE_CLAIM_FAILED'};
  }
  try {
    const raw=await readFile(claimPath,'utf8');
    return {ok:true,lease:JSON.parse(raw),claimPath};
  } catch {
    return {ok:false,reason:'LEASE_INVALID_OR_UNREADABLE',claimPath};
  }
}

async function persistClaimReceipt(claimPath,lease,decision,now) {
  if (!claimPath) return;
  const receipt={...lease,consumed:true,consumedAt:new Date(now).toISOString(),
    decision:decision.ok?'ALLOW_ONCE':'DENY_CONSUMED_FAIL_CLOSED',decisionReason:decision.reason};
  try { await writeFile(claimPath,JSON.stringify(receipt,null,2)+'\n',{encoding:'utf8',flag:'w'}); }
  catch { /* never reopen a consumed lease */ }
}

export async function inspectActiveLease({leasePath=DEFAULT_LEASE_PATH,now=Date.now()}={}) {
  try {
    const lease=JSON.parse(await readFile(leasePath,'utf8'));
    return validateLeaseEnvelope(lease,{now}).ok ? lease : null;
  } catch { return null; }
}

export async function filterRemoteToolDefinitions(tools,{leasePath=DEFAULT_LEASE_PATH,now=Date.now()}={}) {
  const lease=await inspectActiveLease({leasePath,now});
  const visible=tools.filter((tool)=>READ_ONLY_TOOLS.includes(tool.name) || (lease && tool.name===lease.tool));
  return [...visible,AUTHORIZATION_TOOL_DEFINITION];
}


function readTargets(tool,args={}) {
  if (tool==='read_file') return args.isUrl===true ? [] : [args.path];
  if (tool==='read_multiple_files') return Array.isArray(args.paths) ? args.paths : [];
  if (tool==='list_directory' || tool==='start_search' || tool==='get_file_info') return [args.path];
  return [];
}

function normalizeRealWindows(value) {
  if (typeof value!=='string' || !path.win32.isAbsolute(value)) return null;
  return path.win32.normalize(value).replace(/[\\/]+$/,'').toLowerCase();
}

function withinRealRoot(candidate,root) {
  const c=normalizeRealWindows(candidate), r=normalizeRealWindows(root);
  return Boolean(c&&r&&(c===r||c.startsWith(r+'\\')));
}

export async function verifyRealReadScope(tool,args={}, {realpathImpl=realpath}={}) {
  const targets=readTargets(tool,args).filter(Boolean);
  if (!targets.length) return {ok:true,reason:'READ_REALPATH_NOT_APPLICABLE'};
  const settled=await Promise.allSettled(OBSERVATION_DIRECTORIES.map((root)=>realpathImpl(root)));
  const roots=settled.filter((x)=>x.status==='fulfilled').map((x)=>x.value).filter(Boolean);
  if (!roots.length) return denial('READ_REAL_ROOTS_UNAVAILABLE');
  for (const target of targets) {
    let resolved;
    try { resolved=await realpathImpl(target); }
    catch { return denial('READ_REALPATH_UNRESOLVED'); }
    if (!roots.some((root)=>withinRealRoot(resolved,root))) return denial('READ_REPARSE_ESCAPE_DENIED');
  }
  return {ok:true,reason:'READ_REALPATH_SCOPE_PASS'};
}

export async function enforceRemoteToolCall({
  tool,args={},now=Date.now(),leasePath=DEFAULT_LEASE_PATH,fetchImpl=globalThis.fetch
}={}) {
  if (tool===AUTHORIZATION_TOOL) {
    const installed=await installOwnerLeaseFromAuthorization(args,{fetchImpl,leasePath,now});
    if (!installed.ok) return installed;
    return {
      ...installed,
      terminalResult:{
        content:[{type:'text',text:'TIGERIQ_OWNER_LEASE_INSTALLED:'+installed.leaseId}],
        isError:false,
      },
    };
  }
  const kind=classifyTool(tool);
  if (kind==='READ_ONLY') {
    const lexical=authorizeRemoteCall({tool,args,now});
    if (!lexical.ok) return lexical;
    return verifyRealReadScope(tool,args);
  }
  if (kind==='UNKNOWN') return denial('UNKNOWN_TOOL_FAIL_CLOSED');
  if (tool==='set_config_value') return denial('REMOTE_CONFIG_MUTATION_FORBIDDEN');

  const claimed=await claimLease(leasePath,now);
  if (!claimed.ok) return denial(claimed.reason);

  const localDecision=authorizeRemoteCall({tool,args,lease:claimed.lease,now});
  if (!localDecision.ok) {
    await persistClaimReceipt(claimed.claimPath,claimed.lease,localDecision,now);
    return denial(localDecision.reason,{leaseId:claimed.lease?.leaseId});
  }

  const ownerDecision=await verifyOwnerAuthorizationRef(claimed.lease,{fetchImpl});
  const finalDecision=ownerDecision.ok ? {ok:true,reason:'OWNER_LEASE_VALID_SINGLE_USE'} : ownerDecision;
  await persistClaimReceipt(claimed.claimPath,claimed.lease,finalDecision,now);
  return finalDecision.ok
    ? {ok:true,reason:'OWNER_LEASE_VALID_SINGLE_USE',leaseId:claimed.lease.leaseId}
    : denial(finalDecision.reason,{leaseId:claimed.lease?.leaseId});
}

export function formatRemoteGuardDenial(decision) {
  return 'TIGERIQ_REMOTE_GUARD_DENY:'+(decision?.reason||'FAIL_CLOSED');
}
