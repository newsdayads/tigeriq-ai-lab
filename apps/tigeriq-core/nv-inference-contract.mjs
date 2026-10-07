const ALLOWED_CAPABILITIES=new Set(['general','reasoning','review']);

function inputError(code){
  const error=new Error(code);
  error.kind='input';
  error.statusCode=400;
  return error;
}

function boundedList(value,{lower=false}={}){
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value))throw inputError('NV_INFERENCE_EXCLUSION_LIST_INVALID');
  const out=[...new Set(value.map(item=>String(item||'').trim()).filter(Boolean).map(item=>lower?item.toLowerCase():item))];
  if(out.length>16||out.some(item=>item.length>180))throw inputError('NV_INFERENCE_EXCLUSION_LIST_INVALID');
  return out;
}

export function normalizeNvInferenceRequest(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw inputError('NV_INFERENCE_BODY_INVALID');
  const prompt=String(input.prompt||'').trim();
  if(!prompt)throw inputError('NV_INFERENCE_PROMPT_REQUIRED');
  if(prompt.length>60000)throw inputError('NV_INFERENCE_PROMPT_TOO_LARGE');
  const capability=String(input.capability||'reasoning').trim().toLowerCase();
  if(!ALLOWED_CAPABILITIES.has(capability))throw inputError('NV_INFERENCE_CAPABILITY_INVALID');
  const taskKind=String(input.taskKind||'external_nv_inference').trim();
  if(!/^[A-Za-z0-9._:-]{1,64}$/.test(taskKind))throw inputError('NV_INFERENCE_TASK_KIND_INVALID');
  const maxAttempts=input.maxAttempts===undefined?3:Number(input.maxAttempts);
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw inputError('NV_INFERENCE_MAX_ATTEMPTS_INVALID');
  return {
    prompt,
    capability,
    taskKind,
    maxAttempts,
    excludeResourceIds:boundedList(input.excludeResourceIds),
    excludeProviders:boundedList(input.excludeProviders,{lower:true}),
  };
}

export function publicNvInferenceResult(result={}){
  const resource=result?.resource||{};
  const text=String(result?.text||'');
  if(!text.trim())throw inputError('NV_INFERENCE_EMPTY_RESULT');
  return {
    ok:true,
    text,
    employeeId:String(resource.id||resource.employee_id||'')||null,
    resourceId:String(resource.resourceId||resource.resource_id||'')||null,
    provider:String(resource.provider||'').toLowerCase()||null,
    model:String(resource.model||'')||null,
    latencyMs:Number(result?.latencyMs)||0,
    failures:Array.isArray(result?.failures)?result.failures.map(item=>({
      employeeId:String(item?.employeeId||'')||null,
      resourceId:String(item?.resourceId||'')||null,
      provider:String(item?.provider||'').toLowerCase()||null,
      kind:String(item?.kind||'outage').slice(0,80),
    })):[],
  };
}
