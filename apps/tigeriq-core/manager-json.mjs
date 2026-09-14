function managerError(code,cause){const error=new Error(code);error.code=code;error.kind='invalid_response';if(cause)error.cause=cause;return error;}

export function parseManagerJson(text){
  const raw=String(text||'').trim();
  const clean=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  if(!clean)throw managerError('MANAGER_JSON_MISSING');
  let value;
  try{value=JSON.parse(clean);}catch(error){throw managerError('MANAGER_JSON_INVALID',error);}
  if(!value||typeof value!=='object'||Array.isArray(value))throw managerError('MANAGER_SCHEMA_INVALID');
  if(!['continue','complete','blocked'].includes(value.status))throw managerError('MANAGER_STATUS_INVALID');
  if(typeof value.summary!=='string')throw managerError('MANAGER_SCHEMA_INVALID');
  const jobs=Array.isArray(value.jobs)?value.jobs.slice(0,3):[];
  if(value.status==='continue'&&!jobs.length)throw managerError('MANAGER_SCHEMA_INVALID');
  for(const job of jobs){
    if(!job||typeof job!=='object'||typeof job.title!=='string'||typeof job.prompt!=='string')throw managerError('MANAGER_SCHEMA_INVALID');
    if(job.capability!==undefined&&!['general','reasoning','review'].includes(job.capability))throw managerError('MANAGER_SCHEMA_INVALID');
  }
  return {...value,jobs};
}

export function isRetryableManagerOutputError(error){
  return ['MANAGER_JSON_MISSING','MANAGER_JSON_INVALID','MANAGER_STATUS_INVALID','MANAGER_SCHEMA_INVALID'].includes(error?.code||error?.message);
}
export function strictManagerRetryPrompt(prompt){
  return `${prompt}\nSTRICT RETRY: return exactly one JSON object and nothing else. No markdown fences, prose, comments, or trailing text. Keep the required schema exactly.`;
}

export async function runBoundedManagerDecision({prompt,acquire,invoke,onSuccess,onFailure,onRetry,maxProviders=3}){
  const failures=[];const excluded=[];
  for(let providerIndex=0;providerIndex<maxProviders;providerIndex++){
    const resource=await acquire(excluded);if(!resource)break;
    const resourceId=resource.id||resource.employee_id;excluded.push(resourceId);
    for(let attempt=0;attempt<2;attempt++){
      try{
        const text=await invoke(resource,attempt===0?prompt:strictManagerRetryPrompt(prompt));
        const decision=parseManagerJson(text);
        await onSuccess?.(resource,{attempt:attempt+1,text});
        return {decision,resource,failures,providerAttempts:providerIndex+1,outputAttempts:attempt+1};
      }catch(error){
        const retryable=isRetryableManagerOutputError(error);
        failures.push({employeeId:resourceId,attempt:attempt+1,kind:error?.kind||'invalid_response',message:String(error?.code||error?.message||error)});
        if(retryable&&attempt===0){await onRetry?.(resource,error,{attempt:1});continue;}
        await onFailure?.(resource,error,{attempt:attempt+1,retryable});
        break;
      }
    }
  }
  return {
    decision:{status:'blocked',summary:'manager decision exhausted after bounded retry/failover',jobs:[]},
    resource:null,
    failures,
    providerAttempts:excluded.length,
    outputAttempts:0,
    exhausted:true,
  };
}
