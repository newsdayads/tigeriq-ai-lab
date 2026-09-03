export type ProviderKind='local'|'external';
export type CostClass='free'|'metered'|'paid';
export type Capability='reasoning'|'coding'|'research'|'vision'|'review'|'judge'|'fast'|'long-context';
export type EmployeeRole='chief'|'architect'|'researcher'|'coder'|'tester'|'reviewer'|'judge'|'operator';
export type TaskStage='queued'|'waiting_dependency'|'running'|'review'|'done'|'failed'|'blocked'|'authorization';

export interface ProviderDefinition {
  providerId:string;
  kind:ProviderKind;
  enabled:boolean;
  healthy:boolean;
  costClass:CostClass;
  maxConcurrency:number;
  remainingQuota?:number;
  latencyMs?:number;
  secretRef?:string;
}

export interface ModelDefinition {
  modelId:string;
  providerId:string;
  enabled:boolean;
  capabilities:Capability[];
  quality:number;
  speed:number;
  contextTokens:number;
  costWeight:number;
}

export interface EmployeeDefinition {
  employeeId:string;
  role:EmployeeRole;
  enabled:boolean;
  requiredCapabilities:Capability[];
  preferredModels?:string[];
}

export interface RoutingRequest {
  requiredCapabilities:Capability[];
  preferFree:boolean;
  requireExternalDiversity?:boolean;
  excludedModels?:string[];
  maxCostWeight?:number;
}

export interface RouteCandidate {provider:ProviderDefinition;model:ModelDefinition;score:number;}

export interface WorkTask {
  taskId:string;
  goalId:string;
  stage:TaskStage;
  dependencies:string[];
  requiredCapabilities:Capability[];
  priority:'P0'|'P1'|'P2'|'P3';
  authorModelId?:string;
  assignedModelId?:string;
  attempts:number;
}

export interface SchedulerLimits {globalConcurrency:number;providerRunning:Record<string,number>;}
export interface ScheduledTask {task:WorkTask;route:RouteCandidate;}
export interface ReviewAssignment {taskId:string;reviewerModelId:string;independent:boolean;}
export type JudgeDecision='pass'|'fix'|'blocked'|'authorization';

const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const rank={P0:0,P1:1,P2:2,P3:3} as const;
function id(value:string,name:string):string{if(!idPattern.test(value))throw new Error(`INVALID_${name.toUpperCase()}`);return value;}

export function validateRegistry(providers:ProviderDefinition[],models:ModelDefinition[],employees:EmployeeDefinition[]):void{
  const providerIds=new Set<string>();
  for(const provider of providers){
    id(provider.providerId,'provider_id');
    if(providerIds.has(provider.providerId)||provider.maxConcurrency<1||provider.maxConcurrency>128)throw new Error('INVALID_OR_DUPLICATE_PROVIDER');
    if(provider.remainingQuota!==undefined&&provider.remainingQuota<0)throw new Error('INVALID_PROVIDER_QUOTA');
    providerIds.add(provider.providerId);
  }
  const modelIds=new Set<string>();
  for(const model of models){
    id(model.modelId,'model_id');
    if(modelIds.has(model.modelId)||!providerIds.has(model.providerId)||model.quality<0||model.quality>100||model.speed<0||model.speed>100||model.contextTokens<1024||model.costWeight<0)throw new Error('INVALID_OR_DUPLICATE_MODEL');
    modelIds.add(model.modelId);
  }
  const employeeIds=new Set<string>();
  for(const employee of employees){
    id(employee.employeeId,'employee_id');
    if(employeeIds.has(employee.employeeId))throw new Error('DUPLICATE_EMPLOYEE');
    if(employee.preferredModels?.some(modelId=>!modelIds.has(modelId)))throw new Error('UNKNOWN_EMPLOYEE_MODEL');
    employeeIds.add(employee.employeeId);
  }
}

function supports(model:ModelDefinition,required:Capability[]):boolean{return required.every(capability=>model.capabilities.includes(capability));}
function providerAvailable(provider:ProviderDefinition):boolean{return provider.enabled&&provider.healthy&&(provider.remainingQuota===undefined||provider.remainingQuota>0);}

export function routeModels(providers:ProviderDefinition[],models:ModelDefinition[],request:RoutingRequest):RouteCandidate[]{
  const byProvider=new Map(providers.map(provider=>[provider.providerId,provider]));
  const excluded=new Set(request.excludedModels??[]);
  return models
    .filter(model=>model.enabled&&!excluded.has(model.modelId)&&supports(model,request.requiredCapabilities))
    .map(model=>({model,provider:byProvider.get(model.providerId)}))
    .filter((row):row is {model:ModelDefinition;provider:ProviderDefinition}=>Boolean(row.provider&&providerAvailable(row.provider)))
    .filter(({model})=>request.maxCostWeight===undefined||model.costWeight<=request.maxCostWeight)
    .map(({model,provider})=>{
      const freeBonus=request.preferFree?(provider.costClass==='free'?35:provider.costClass==='metered'?8:-20):0;
      const localBonus=request.preferFree&&provider.kind==='local'?12:0;
      const quotaPenalty=provider.remainingQuota!==undefined&&provider.remainingQuota<5?15:0;
      const latencyPenalty=Math.min(20,Math.round((provider.latencyMs??0)/500));
      const score=model.quality*0.55+model.speed*0.25-freeBonus*-1+localBonus-model.costWeight*5-quotaPenalty-latencyPenalty;
      return {provider,model,score};
    })
    .sort((a,b)=>b.score-a.score||a.model.modelId.localeCompare(b.model.modelId));
}

export function selectRoute(providers:ProviderDefinition[],models:ModelDefinition[],request:RoutingRequest):RouteCandidate|undefined{
  return routeModels(providers,models,request)[0];
}

export function selectFallback(primary:RouteCandidate,providers:ProviderDefinition[],models:ModelDefinition[],request:RoutingRequest):RouteCandidate|undefined{
  const candidates=routeModels(providers,models,{...request,excludedModels:[...(request.excludedModels??[]),primary.model.modelId]});
  if(request.requireExternalDiversity){
    const diverse=candidates.find(candidate=>candidate.provider.providerId!==primary.provider.providerId);
    if(diverse)return diverse;
  }
  return candidates[0];
}

export function resolveEmployee(employee:EmployeeDefinition,providers:ProviderDefinition[],models:ModelDefinition[],preferFree=true):RouteCandidate|undefined{
  const preferred=employee.preferredModels??[];
  const eligible=models.filter(model=>preferred.length===0||preferred.includes(model.modelId));
  return selectRoute(providers,eligible,{requiredCapabilities:employee.requiredCapabilities,preferFree});
}

export function scheduleReadyTasks(tasks:WorkTask[],providers:ProviderDefinition[],models:ModelDefinition[],limits:SchedulerLimits):ScheduledTask[]{
  if(limits.globalConcurrency<1)throw new Error('INVALID_GLOBAL_CONCURRENCY');
  const done=new Set(tasks.filter(task=>task.stage==='done').map(task=>task.taskId));
  const runningCount=tasks.filter(task=>task.stage==='running'||task.stage==='review').length;
  let remaining=Math.max(0,limits.globalConcurrency-runningCount);
  const providerRunning={...limits.providerRunning};
  const scheduled:ScheduledTask[]=[];
  const ordered=tasks.filter(task=>task.stage==='queued'&&task.dependencies.every(dep=>done.has(dep))).sort((a,b)=>rank[a.priority]-rank[b.priority]||a.taskId.localeCompare(b.taskId));
  for(const task of ordered){
    if(remaining<=0)break;
    const candidates=routeModels(providers,models,{requiredCapabilities:task.requiredCapabilities,preferFree:true});
    const route=candidates.find(candidate=>(providerRunning[candidate.provider.providerId]??0)<candidate.provider.maxConcurrency);
    if(!route)continue;
    scheduled.push({task,route});
    providerRunning[route.provider.providerId]=(providerRunning[route.provider.providerId]??0)+1;
    remaining--;
  }
  return scheduled;
}

export function assignIndependentReviewer(task:WorkTask,providers:ProviderDefinition[],models:ModelDefinition[]):ReviewAssignment|undefined{
  const candidates=routeModels(providers,models,{requiredCapabilities:['review'],preferFree:true,excludedModels:task.authorModelId?[task.authorModelId]:[],requireExternalDiversity:true});
  const reviewer=candidates.find(candidate=>candidate.model.modelId!==task.authorModelId);
  if(!reviewer)return undefined;
  return {taskId:task.taskId,reviewerModelId:reviewer.model.modelId,independent:reviewer.model.modelId!==task.authorModelId};
}

export function judgeFromChecks(input:{testsPassed:boolean;reviewPassed:boolean;authorizationRequired:boolean;blocked:boolean}):JudgeDecision{
  if(input.authorizationRequired)return 'authorization';
  if(input.blocked)return 'blocked';
  if(!input.testsPassed||!input.reviewPassed)return 'fix';
  return 'pass';
}

export function providerCapacity(providers:ProviderDefinition[],running:Record<string,number>):number{
  return providers.filter(provider=>providerAvailable(provider)).reduce((sum,provider)=>sum+Math.max(0,provider.maxConcurrency-(running[provider.providerId]??0)),0);
}
