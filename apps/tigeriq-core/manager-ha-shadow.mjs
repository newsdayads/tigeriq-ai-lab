import { failurePolicy, rankCandidates } from './smart-router.mjs';
import { governPlanDelta } from './manager-plan-delta.mjs';

export const MANAGER_SHADOW_FLAG='TIGERIQ_CORE_VNEXT_SHADOW';

export function managerShadowEnabled(env=process.env){
  return ['1','true','on','yes'].includes(String(env?.[MANAGER_SHADOW_FLAG]||'').trim().toLowerCase());
}

export function managerRoleIdentity(resource={}){
  return Object.freeze({
    role:'MANAGER',
    employeeId:String(resource.employee_id??resource.employeeId??'').trim()||null,
    resourceId:String(resource.resource_id??resource.resourceId??'').trim()||null,
    provider:String(resource.provider||'').trim()||null,
    model:String(resource.model||'').trim()||null,
  });
}

export function rankManagerShadowCandidates(resources,{nowMs=Date.now(),maxProviders=3,excludeResourceIds=[]}={}){
  const excluded=new Set((Array.isArray(excludeResourceIds)?excludeResourceIds:[]).map(String));
  const filtered=(Array.isArray(resources)?resources:[]).filter(resource=>!excluded.has(String(resource.resource_id??resource.resourceId??'')));
  const ranking=rankCandidates(filtered,{
    profile:'RESEARCH',
    capability:'reasoning',
    taskKind:'manager_shadow',
    nowMs,
    requireFunctionalEvidence:true,
  });
  const byId=new Map(filtered.map(resource=>[String(resource.resource_id??resource.resourceId??''),resource]));
  const eligible=ranking.candidates
    .filter(candidate=>candidate.eligible)
    .sort((a,b)=>(a.score??Infinity)-(b.score??Infinity)||String(a.resourceId).localeCompare(String(b.resourceId)))
    .slice(0,Math.max(1,Math.min(5,Number(maxProviders)||3)))
    .map(candidate=>({candidate,resource:byId.get(String(candidate.resourceId))}))
    .filter(item=>item.resource);
  return {ranking,eligible};
}

export function buildManagerShadowPrompt({objectiveId,sourceRevision,goal}={}){
  return [
    'You are TigerIQ Shadow Manager. Produce planning evidence only; do not execute side effects.',
    'Return exactly one JSON object with schema TIGERIQ_PLAN_DELTA_V1.',
    'objectiveId='+String(objectiveId||''),
    'sourceRevision='+String(sourceRevision||''),
    'goal='+String(goal||'').slice(0,6000),
    'All task effects must explicitly declare repoMutation, productionRelease, paidCost, credentialChange, securityBoundaryChange, destructive as booleans.',
    'P0 tasks are forbidden. Production/paid/credential/security/destructive effects are forbidden.',
    'Reviewer and implementer resource identities must differ when both are specified.',
  ].join('\n');
}

function parsePlanOutput(output){
  if(output&&typeof output==='object'&&!Array.isArray(output))return output;
  const text=String(output||'').trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'').trim();
  if(!text)throw Object.assign(new Error('PLAN_OUTPUT_MISSING'),{kind:'invalid_response'});
  try{return JSON.parse(text);}
  catch(cause){throw Object.assign(new Error('PLAN_OUTPUT_INVALID'),{kind:'invalid_response',cause});}
}

export async function runManagerShadowPlan({
  env=process.env,
  resources=[],
  objectiveId='',
  sourceRevision='',
  goal='',
  invoke,
  nowMs=Date.now(),
  maxProviders=3,
  maxTasks=8,
  activeResourceScopes=[],
  reviewerResourceIds=[],
}={}){
  if(!managerShadowEnabled(env))return {state:'disabled',invoked:false,flag:MANAGER_SHADOW_FLAG,evidence:{sideEffects:0}};
  if(typeof invoke!=='function')throw new Error('MANAGER_SHADOW_INVOKE_REQUIRED');
  const prompt=buildManagerShadowPrompt({objectiveId,sourceRevision,goal});
  const {ranking,eligible}=rankManagerShadowCandidates(resources,{nowMs,maxProviders});
  const failures=[];
  for(let index=0;index<eligible.length;index++){
    const {candidate,resource}=eligible[index];
    const identity=managerRoleIdentity(resource);
    try{
      const raw=await invoke(resource,prompt,{role:identity,attempt:index+1,maxProviders:eligible.length});
      const plan=parsePlanOutput(raw);
      const governed=governPlanDelta(plan,{expectedObjectiveId:objectiveId,expectedSourceRevision:sourceRevision,maxTasks,activeResourceScopes,reviewerResourceIds});
      if(governed.decision==='accept'||governed.decision==='trim'){
        return {
          state:'planned',
          invoked:true,
          role:identity,
          attempt:index+1,
          decision:governed.decision,
          plan:governed.plan,
          trimmedTaskIds:governed.trimmedTaskIds,
          failures,
          ranking:ranking.candidates,
          evidence:{sideEffects:0,shadowOnly:true,sourceRevision:String(sourceRevision),resourceId:identity.resourceId},
        };
      }
      const error=Object.assign(new Error(governed.reason||'PLAN_GOVERNOR_REJECTED'),{kind:'invalid_response',governed});
      throw error;
    }catch(error){
      const kind=String(error?.kind||'outage');
      const policy=failurePolicy(kind);
      failures.push({
        resourceId:String(candidate.resourceId),
        employeeId:candidate.employeeId??identity.employeeId,
        provider:candidate.provider??identity.provider,
        kind:policy.kind,
        message:String(error?.message||error).slice(0,300),
        policy,
      });
      if(policy.stop){
        return {state:'deferred',invoked:true,reason:'MANAGER_SHADOW_SAFETY_STOP',failures,ranking:ranking.candidates,evidence:{sideEffects:0,shadowOnly:true}};
      }
    }
  }
  return {
    state:'deferred',
    invoked:eligible.length>0,
    reason:eligible.length?'MANAGER_SHADOW_PROVIDERS_EXHAUSTED':'MANAGER_SHADOW_NO_ELIGIBLE_RESOURCE',
    failures,
    ranking:ranking.candidates,
    evidence:{sideEffects:0,shadowOnly:true},
  };
}
