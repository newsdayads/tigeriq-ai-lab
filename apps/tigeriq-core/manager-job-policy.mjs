export function normalizeManagerLogicalTitle(value='') {
  return String(value ?? '').trim().toLowerCase();
}

export function managerLogicalJobIdentity({objectiveId='', phaseIndex=0, title=''}={}) {
  return {
    objectiveId: String(objectiveId || '').trim(),
    phaseIndex: Math.max(0, Number(phaseIndex) || 0),
    normalizedTitle: normalizeManagerLogicalTitle(title),
  };
}

export const FAILED_LOGICAL_JOB_BLOCK_SUMMARY='Same logical job has already failed; no new random job on unchanged work';
export const MANAGER_NO_PROGRESS_BLOCK_SUMMARY='Manager attempt stopped: two decisions without accepted child progress; awaiting material change';

export function providerPromptCompactionRecoveryEligible({
  capability='',
  phaseIndex=0,
  maxAttempts=0,
  compactRepairReason='',
  failure=null,
}={}) {
  if(String(capability).trim().toLowerCase()!=='review'||Number(phaseIndex)<=0)return false;
  if(Number(maxAttempts)!==5)return false;
  if(String(compactRepairReason||'')!=='compact_contract_already_present')return false;
  const failures=Array.isArray(failure?.failures)?failure.failures:[];
  return failures.some(item=>
    String(item?.kind||'').trim().toLowerCase()==='job_contract'
    &&String(item?.message||'').trim()==='NV09_COMPILED_PROMPT_BUDGET_EXCEEDED'
  );
}

export function failedCampaignRuntimeRearmDecision({
  objectiveStatus='',
  objectiveSummary='',
  jobStatus='',
  attempts=0,
  maxAttempts=0,
  jobCompletedAt='',
  runtimeUpdatedAt='',
  hasCampaign=false,
  routingProfile='',
  promptRepairEligible=false,
  promptRepairCap=4,
}={}) {
  if(String(objectiveStatus).trim().toLowerCase()!=='blocked')return {action:'keep',reason:'objective_not_blocked'};
  if(![FAILED_LOGICAL_JOB_BLOCK_SUMMARY,MANAGER_NO_PROGRESS_BLOCK_SUMMARY].includes(String(objectiveSummary)))return {action:'keep',reason:'not_failed_campaign_rearm_guard'};
  if(String(jobStatus).trim().toLowerCase()!=='failed')return {action:'keep',reason:'job_not_failed'};
  if(!hasCampaign||String(routingProfile).trim().toUpperCase()!=='LOCAL')return {action:'keep',reason:'not_local_campaign'};
  const used=Math.max(0,Number(attempts)||0),limit=Math.max(0,Number(maxAttempts)||0);
  const failedAt=Date.parse(String(jobCompletedAt||'')),runtimeAt=Date.parse(String(runtimeUpdatedAt||''));
  if(!Number.isFinite(failedAt)||!Number.isFinite(runtimeAt)||runtimeAt<=failedAt)return {action:'keep',reason:'runtime_not_newer_than_failure'};
  if(limit<=0)return {action:'keep',reason:'retry_budget_exhausted'};
  if(used>=limit){
    const cap=Math.max(1,Math.min(6,Number(promptRepairCap)||4));
    if(promptRepairEligible===true&&used===limit&&limit<cap){
      return {action:'requeue_prompt_repair',reason:'runtime_source_newer_with_prompt_repair_credit',nextMaxAttempts:limit+1};
    }
    return {action:'keep',reason:'retry_budget_exhausted'};
  }
  return {action:'requeue',reason:'runtime_source_newer_than_failed_campaign_job',nextMaxAttempts:limit};
}

export function managerJobMaterializationDecision(existingStatus='') {
  const status=String(existingStatus || '').trim().toLowerCase();
  if(!status)return {action:'create',reason:'no_existing_job'};
  if(status==='failed')return {action:'block',reason:'previous_failed_terminal_no_duplicate_job'};
  return {action:'dedupe',reason:`existing_${status}`};
}
