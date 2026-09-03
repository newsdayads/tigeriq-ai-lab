import { validateRegistry,type Capability,type CostClass,type EmployeeDefinition,type EmployeeRole,type ModelDefinition,type ProviderDefinition,type ProviderKind } from './core.js';

const capabilities:Capability[]=['reasoning','coding','research','vision','review','judge','fast','long-context'];
const roles:EmployeeRole[]=['chief','architect','researcher','coder','tester','reviewer','judge','operator'];
const providerKinds:ProviderKind[]=['local','external'];
const costClasses:CostClass[]=['free','metered','paid'];
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
function root(raw:unknown,name:string):Record<string,unknown>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`INVALID_${name.toUpperCase()}`);return raw as Record<string,unknown>;}
function id(value:unknown,name:string):string{if(typeof value!=='string'||!idPattern.test(value))throw new Error(`INVALID_${name.toUpperCase()}`);return value;}
function bool(value:unknown,name:string):boolean{if(typeof value!=='boolean')throw new Error(`INVALID_${name.toUpperCase()}`);return value;}
function num(value:unknown,name:string,min:number,max=Number.MAX_SAFE_INTEGER):number{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`INVALID_${name.toUpperCase()}`);return value;}
function strings<T extends string>(value:unknown,name:string,allowed:readonly T[],max=32):T[]{if(!Array.isArray(value)||value.length>max)throw new Error(`INVALID_${name.toUpperCase()}`);return value.map((item,index)=>{if(typeof item!=='string'||!allowed.includes(item as T))throw new Error(`INVALID_${name.toUpperCase()}_${index}`);return item as T;});}

export function parseProviderRegistry(raw:unknown):ProviderDefinition[]{
  const data=root(raw,'provider_registry');if(data.version!==1||!Array.isArray(data.providers)||data.providers.length>128)throw new Error('INVALID_PROVIDER_REGISTRY');
  return data.providers.map((value,index)=>{const row=root(value,`provider_${index}`),kind=id(row.kind,'provider_kind') as ProviderKind,costClass=id(row.costClass,'provider_cost_class') as CostClass;if(!providerKinds.includes(kind)||!costClasses.includes(costClass))throw new Error('INVALID_PROVIDER_CLASS');const remainingQuota=row.remainingQuota===undefined?undefined:num(row.remainingQuota,'provider_remaining_quota',0);const latencyMs=row.latencyMs===undefined?undefined:num(row.latencyMs,'provider_latency',0);const secretRef=row.secretRef===undefined||row.secretRef===null?undefined:id(row.secretRef,'provider_secret_ref');return {providerId:id(row.providerId,'provider_id'),kind,enabled:bool(row.enabled,'provider_enabled'),healthy:bool(row.healthy,'provider_healthy'),costClass,maxConcurrency:num(row.maxConcurrency,'provider_max_concurrency',1,128),remainingQuota,latencyMs,secretRef};});
}

export function parseModelRegistry(raw:unknown):ModelDefinition[]{
  const data=root(raw,'model_registry');if(data.version!==1||!Array.isArray(data.models)||data.models.length>512)throw new Error('INVALID_MODEL_REGISTRY');
  return data.models.map((value,index)=>{const row=root(value,`model_${index}`);return {modelId:id(row.modelId,'model_id'),providerId:id(row.providerId,'model_provider_id'),enabled:bool(row.enabled,'model_enabled'),capabilities:strings(row.capabilities,'model_capabilities',capabilities),quality:num(row.quality,'model_quality',0,100),speed:num(row.speed,'model_speed',0,100),contextTokens:num(row.contextTokens,'model_context_tokens',1024,10_000_000),costWeight:num(row.costWeight,'model_cost_weight',0,1_000_000)};});
}

export function parseEmployeeRegistry(raw:unknown):EmployeeDefinition[]{
  const data=root(raw,'employee_registry');if(data.version!==1||!Array.isArray(data.employees)||data.employees.length>4096)throw new Error('INVALID_EMPLOYEE_REGISTRY');
  return data.employees.map((value,index)=>{const row=root(value,`employee_${index}`),role=id(row.role,'employee_role') as EmployeeRole;if(!roles.includes(role))throw new Error('INVALID_EMPLOYEE_ROLE');const preferredModels=row.preferredModels===undefined?undefined:(Array.isArray(row.preferredModels)?row.preferredModels.map((model,i)=>id(model,`preferred_model_${i}`)):(()=>{throw new Error('INVALID_EMPLOYEE_PREFERRED_MODELS');})());return {employeeId:id(row.employeeId,'employee_id'),role,enabled:bool(row.enabled,'employee_enabled'),requiredCapabilities:strings(row.requiredCapabilities,'employee_capabilities',capabilities),preferredModels};});
}

export function parseAndValidateRegistries(input:{providers:unknown;models:unknown;employees:unknown}){
  const providers=parseProviderRegistry(input.providers),models=parseModelRegistry(input.models),employees=parseEmployeeRegistry(input.employees);validateRegistry(providers,models,employees);return {providers,models,employees};
}
