export const TERMINAL_BLOCKED_LABEL='tigeriq:terminal-blocked';

export function githubLabelName(label){
  return String(typeof label==='string'?label:label?.name||'').trim();
}

export function hasTerminalBlockedLabel(issue){
  return (Array.isArray(issue?.labels)?issue.labels:[]).some(label=>githubLabelName(label).toLowerCase()===TERMINAL_BLOCKED_LABEL);
}

function statusCode(error){return Number(error?.status||error?.statusCode||0)}

export async function ensureTerminalBlockedLabel({request}={}){
  if(typeof request!=='function')throw new Error('GITHUB_LABEL_REQUEST_REQUIRED');
  const encoded=encodeURIComponent(TERMINAL_BLOCKED_LABEL);
  try{
    await request(`/labels/${encoded}`);
    return true;
  }catch(error){
    if(statusCode(error)!==404)throw error;
  }
  try{
    await request('/labels',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        name:TERMINAL_BLOCKED_LABEL,
        color:'B60205',
        description:'TigerIQ machine lifecycle: terminal blocked',
      }),
    });
  }catch(error){
    if(statusCode(error)!==422)throw error;
  }
  return true;
}

export async function setTerminalBlockedLabel({issueNumber,request}={}){
  const n=Number(issueNumber);
  if(!Number.isInteger(n)||n<=0)throw new Error('GITHUB_LABEL_ISSUE_NUMBER_INVALID');
  await ensureTerminalBlockedLabel({request});
  await request(`/issues/${n}/labels`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({labels:[TERMINAL_BLOCKED_LABEL]}),
  });
  return true;
}

export async function clearTerminalBlockedLabel({issueNumber,request}={}){
  const n=Number(issueNumber);
  if(!Number.isInteger(n)||n<=0)throw new Error('GITHUB_LABEL_ISSUE_NUMBER_INVALID');
  if(typeof request!=='function')throw new Error('GITHUB_LABEL_REQUEST_REQUIRED');
  try{
    await request(`/issues/${n}/labels/${encodeURIComponent(TERMINAL_BLOCKED_LABEL)}`,{method:'DELETE'});
  }catch(error){
    if(statusCode(error)!==404)throw error;
  }
  return true;
}
