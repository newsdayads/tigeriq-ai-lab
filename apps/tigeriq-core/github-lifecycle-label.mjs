const DEFAULT_LABEL='tigeriq:terminal-blocked';

export const TERMINAL_BLOCKED_LABEL=DEFAULT_LABEL;

function labelsOf(issue){
  return (Array.isArray(issue?.labels)?issue.labels:[])
    .map((label)=>typeof label==='string'?label:String(label?.name||''))
    .filter(Boolean);
}

export function hasTerminalBlockedLabel(issue,label=DEFAULT_LABEL){
  return labelsOf(issue).some((name)=>name.toLowerCase()===String(label).toLowerCase());
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
    throw error;
  }
  return body;
}

function labelMissingError(error){
  const text=JSON.stringify(error?.body||{})+' '+String(error?.message||'');
  return [404,422].includes(Number(error?.status||0))&&/(label|validation|not found|does not exist)/i.test(text);
}

export async function ensureTerminalBlockedLabel({fetchImpl=fetch,owner,repo,token,label=DEFAULT_LABEL}={}){
  if(!token)return false;
  try{
    await requestJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/labels`,token,{
      method:'POST',
      body:JSON.stringify({name:label,color:'b60205',description:'TigerIQ machine lifecycle: terminal blocked until a fresh claim/rearm clears it.'})
    });
  }catch(error){
    const text=JSON.stringify(error?.body||{})+' '+String(error?.message||'');
    if(Number(error?.status)!==422||!/(already_exists|already exists|validation failed)/i.test(text))throw error;
  }
  return true;
}

export async function addTerminalBlockedLabel({fetchImpl=fetch,owner,repo,issueNumber,token,label=DEFAULT_LABEL}={}){
  if(!token)return false;
  const url=`https://api.github.com/repos/${owner}/${repo}/issues/${Number(issueNumber)}/labels`;
  try{
    await requestJson(fetchImpl,url,token,{method:'POST',body:JSON.stringify({labels:[label]})});
    return true;
  }catch(error){
    if(!labelMissingError(error))throw error;
  }
  await ensureTerminalBlockedLabel({fetchImpl,owner,repo,token,label});
  await requestJson(fetchImpl,url,token,{method:'POST',body:JSON.stringify({labels:[label]})});
  return true;
}

export async function clearTerminalBlockedLabel({fetchImpl=fetch,owner,repo,issueNumber,token,label=DEFAULT_LABEL}={}){
  if(!token)return false;
  const url=`https://api.github.com/repos/${owner}/${repo}/issues/${Number(issueNumber)}/labels/${encodeURIComponent(label)}`;
  try{
    await requestJson(fetchImpl,url,token,{method:'DELETE'});
  }catch(error){
    if(Number(error?.status)!==404)throw error;
  }
  return true;
}
