function managerError(code,cause){const error=new Error(code);error.code=code;error.kind='invalid_response';if(cause)error.cause=cause;return error;}

export function isManagerPrompt(prompt){
  return String(prompt||'').trimStart().startsWith('You are TigerIQ AI Manager.');
}

const STRUCTURED_JSON_HOSTS=new Set(['api.groq.com','openrouter.ai','api.cohere.com','integrate.api.nvidia.com','api.inceptionlabs.ai']);
export function managerResponseFormatForHost(host,prompt){
  return isManagerPrompt(prompt)&&STRUCTURED_JSON_HOSTS.has(String(host||'').toLowerCase())?{type:'json_object'}:null;
}

export function managerLocalRequestBody(model,prompt){
  return {
    model:String(model||'qwen3:4b'),
    prompt:String(prompt||''),
    stream:false,
    think:false,
    format:'json',
    options:{temperature:0,num_ctx:4096,num_predict:512},
  };
}

export function managerShouldUseLocalFallback(excludedCount,cloudBudget=2){
  return Math.max(0,Number(excludedCount)||0)>=Math.max(0,Number(cloudBudget)||0);
}

function parseableJsonObjects(text){
  const s=String(text||'');const out=[];
  for(let start=0;start<s.length;start++){
    if(s[start]!=='{')continue;
    let depth=0,inString=false,escaped=false;
    for(let i=start;i<s.length;i++){
      const ch=s[i];
      if(inString){
        if(escaped){escaped=false;continue;}
        if(ch==='\\'){escaped=true;continue;}
        if(ch==='"')inString=false;
        continue;
      }
      if(ch==='"'){inString=true;continue;}
      if(ch==='{')depth++;
      else if(ch==='}'){
        depth--;
        if(depth===0){
          const candidate=s.slice(start,i+1);
          try{out.push({candidate,value:JSON.parse(candidate)});}catch{}
          start=i;
          break;
        }
      }
    }
  }
  return out;
}

export function parseManagerJson(text){
  const raw=String(text||'').trim();
  const clean=raw.replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'').trim();
  if(!clean)throw managerError('MANAGER_JSON_MISSING');
  let value;
  try{value=JSON.parse(clean);}catch(error){
    const candidates=parseableJsonObjects(clean);
    if(candidates.length>1)throw managerError('MANAGER_JSON_AMBIGUOUS',error);
    if(candidates.length!==1)throw managerError('MANAGER_JSON_INVALID',error);
    value=candidates[0].value;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw managerError('MANAGER_SCHEMA_INVALID');
  if(!['continue','complete','blocked'].includes(value.status))throw managerError('MANAGER_STATUS_INVALID');
  if(typeof value.summary!=='string')throw managerError('MANAGER_SCHEMA_INVALID');
  let jobs = [];
  if (value.status === 'continue') {
    if (!Array.isArray(value.jobs) || value.jobs.length < 1 || value.jobs.length > 3) {
      throw managerError('MANAGER_SCHEMA_INVALID');
    }
    jobs = value.jobs.slice(0, 3);
  } else {
    if (value.jobs !== undefined && (!Array.isArray(value.jobs) || value.jobs.length > 0)) {
      throw managerError('MANAGER_SCHEMA_INVALID');
    }
    jobs = [];
  }
  for(const job of jobs){
    if(!job||typeof job!=='object'||typeof job.title!=='string'||typeof job.prompt!=='string')throw managerError('MANAGER_SCHEMA_INVALID');
    if(job.capability!==undefined&&!['general','reasoning','review'].includes(job.capability))throw managerError('MANAGER_SCHEMA_INVALID');
  }
  return {...value,jobs};
}

export function isRetryableManagerOutputError(error){
  return ['MANAGER_JSON_MISSING','MANAGER_JSON_INVALID','MANAGER_JSON_AMBIGUOUS','MANAGER_STATUS_INVALID','MANAGER_SCHEMA_INVALID'].includes(error?.code||error?.message);
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
        const failureResult=await onFailure?.(resource,error,{attempt:attempt+1,retryable});
        if(failureResult?.stop===true||failureResult?.policy?.stop===true){
          return {
            decision:{status:'blocked',summary:'manager decision stopped by resource failure policy',jobs:[]},
            resource:null,
            failures,
            providerAttempts:providerIndex+1,
            outputAttempts:attempt+1,
            exhausted:false,
            stopped:true,
          };
        }
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
