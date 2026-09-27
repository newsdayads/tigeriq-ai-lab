const DEFAULT_LABEL='tigeriq:terminal-blocked';
const ROLE_CLAIMED_LABEL='tigeriq:role-claimed';
const ROLE_WORKER_PREFIX='tigeriq:role-worker-';

export const TERMINAL_BLOCKED_LABEL=DEFAULT_LABEL;
export const EXTERNAL_ROLE_CLAIMED_LABEL=ROLE_CLAIMED_LABEL;

function labelsOf(issue){
  return (Array.isArray(issue?.labels)?issue.labels:[])
    .map((label)=>typeof label==='string'?label:String(label?.name||''))
    .filter(Boolean);
}

export function hasTerminalBlockedLabel(issue,label=DEFAULT_LABEL){
  return labelsOf(issue).some((name)=>name.toLowerCase()===String(label).toLowerCase());
}

export function roleClaimWorkerLabel(workerId){
  const id=String(workerId||'').trim().toLowerCase();
  return /^nv\d{2}$/.test(id)?ROLE_WORKER_PREFIX+id:'';
}

export function hasRoleClaimedLabel(issue,label=ROLE_CLAIMED_LABEL){
  return labelsOf(issue).some((name)=>name.toLowerCase()===String(label).toLowerCase());
}

export function roleClaimedWorkerId(issue){
  for(const name of labelsOf(issue)){
    const match=String(name).toLowerCase().match(/^tigeriq:role-worker-(nv\d{2})$/);
    if(match)return match[1].toUpperCase();
  }
  return null;
}

async function requestJson(fetchImpl,url,token,init={}){
  const headers={accept:'application/vnd.github+json','content-type':'application/json','user-agent':'TigerIQ-Lifecycle-Label/1.0','x-github-api-version':'2022-11-28',...(init.headers||{})};
  if(token)headers.authorization=`Bearer ${token}`;
  const response=await fetchImpl(url,{...init,headers,signal:AbortSignal.timeout(12000)});
  const raw=response.status===204?'':await response.text();
  let body={};
  if(raw){try{body=JSON.parse(raw)}catch{body={message:raw}}}
  if(!response.ok){
    const error=new Error(`GITHUB_HTTP_${response.status}:${String(body?.message||raw||'').slice(0,300)}`);
    error.status=response.status;
    error.body=body;
    error.retryAfter=response.headers?.get?.('retry-after')||'';
    error.rateLimitRemaining=response.headers?.get?.('x-ratelimit-remaining')||'';
    error.rateLimitReset=response.headers?.get?.('x-ratelimit-reset')||'';
    throw error;
  }
  return body;
}

function labelMissingError(error){
  const text=JSON.stringify(error?.body||{})+' '+String(error?.message||'');
  return [404,422].includes(Number(error?.status||0))&&/(label|validation|not found|does not exist)/i.test(text);
}

async function ensureLabel({fetchImpl=fetch,owner,repo,token,label,color,description}={}){
  if(!token)return false;
  try{
    await requestJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/labels`,token,{
      method:'POST',
      body:JSON.stringify({name:label,color,description})
    });
  }catch(error){
    const text=JSON.stringify(error?.body||{})+' '+String(error?.message||'');
    if(Number(error?.status)!==422||!/(already_exists|already exists|validation failed)/i.test(text))throw error;
  }
  return true;
}

async function addIssueLabel({fetchImpl=fetch,owner,repo,issueNumber,token,label,color,description}={}){
  if(!token)return false;
  const url=`https://api.github.com/repos/${owner}/${repo}/issues/${Number(issueNumber)}/labels`;
  try{
    await requestJson(fetchImpl,url,token,{method:'POST',body:JSON.stringify({labels:[label]})});
    return true;
  }catch(error){
    if(!labelMissingError(error))throw error;
  }
  await ensureLabel({fetchImpl,owner,repo,token,label,color,description});
  await requestJson(fetchImpl,url,token,{method:'POST',body:JSON.stringify({labels:[label]})});
  return true;
}

async function clearIssueLabel({fetchImpl=fetch,owner,repo,issueNumber,token,label}={}){
  if(!token||!label)return false;
  const url=`https://api.github.com/repos/${owner}/${repo}/issues/${Number(issueNumber)}/labels/${encodeURIComponent(label)}`;
  try{
    await requestJson(fetchImpl,url,token,{method:'DELETE'});
  }catch(error){
    if(Number(error?.status)!==404)throw error;
  }
  return true;
}

export async function ensureTerminalBlockedLabel({fetchImpl=fetch,owner,repo,token,label=DEFAULT_LABEL}={}){
  return ensureLabel({fetchImpl,owner,repo,token,label,color:'b60205',description:'TigerIQ machine lifecycle: terminal blocked until a fresh claim/rearm clears it.'});
}

export async function addTerminalBlockedLabel({fetchImpl=fetch,owner,repo,issueNumber,token,label=DEFAULT_LABEL}={}){
  return addIssueLabel({fetchImpl,owner,repo,issueNumber,token,label,color:'b60205',description:'TigerIQ machine lifecycle: terminal blocked until a fresh claim/rearm clears it.'});
}

export async function clearTerminalBlockedLabel({fetchImpl=fetch,owner,repo,issueNumber,token,label=DEFAULT_LABEL}={}){
  return clearIssueLabel({fetchImpl,owner,repo,issueNumber,token,label});
}

export async function addRoleClaimedLabel({fetchImpl=fetch,owner,repo,issueNumber,token,workerId}={}){
  if(!token)return false;
  await addIssueLabel({
    fetchImpl,owner,repo,issueNumber,token,label:ROLE_CLAIMED_LABEL,color:'1d76db',
    description:'TigerIQ external role claim is active; queue projection must not dispatch this Work Order.'
  });
  const workerLabel=roleClaimWorkerLabel(workerId);
  if(workerLabel){
    await addIssueLabel({
      fetchImpl,owner,repo,issueNumber,token,label:workerLabel,color:'5319e7',
      description:'TigerIQ external role claim worker identity for read-only Live projection.'
    });
  }
  return true;
}

export async function clearRoleClaimedLabel({fetchImpl=fetch,owner,repo,issueNumber,token,issue,workerId}={}){
  if(!token)return false;
  await clearIssueLabel({fetchImpl,owner,repo,issueNumber,token,label:ROLE_CLAIMED_LABEL});
  const workerLabels=new Set(labelsOf(issue).filter((name)=>/^tigeriq:role-worker-nv\d{2}$/i.test(name)));
  const explicit=roleClaimWorkerLabel(workerId);
  if(explicit)workerLabels.add(explicit);
  for(const label of workerLabels)await clearIssueLabel({fetchImpl,owner,repo,issueNumber,token,label});
  return true;
}
