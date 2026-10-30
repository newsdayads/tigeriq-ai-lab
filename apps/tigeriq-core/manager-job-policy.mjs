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
}={}) {
  if(String(objectiveStatus).trim().toLowerCase()!=='blocked')return {action:'keep',reason:'objective_not_blocked'};
  if(![FAILED_LOGICAL_JOB_BLOCK_SUMMARY,MANAGER_NO_PROGRESS_BLOCK_SUMMARY].includes(String(objectiveSummary)))return {action:'keep',reason:'not_failed_campaign_rearm_guard'};
  if(String(jobStatus).trim().toLowerCase()!=='failed')return {action:'keep',reason:'job_not_failed'};
  if(!hasCampaign||String(routingProfile).trim().toUpperCase()!=='LOCAL')return {action:'keep',reason:'not_local_campaign'};
  const used=Math.max(0,Number(attempts)||0),limit=Math.max(0,Number(maxAttempts)||0);
  if(limit<=0||used>=limit)return {action:'keep',reason:'retry_budget_exhausted'};
  const failedAt=Date.parse(String(jobCompletedAt||'')),runtimeAt=Date.parse(String(runtimeUpdatedAt||''));
  if(!Number.isFinite(failedAt)||!Number.isFinite(runtimeAt)||runtimeAt<=failedAt)return {action:'keep',reason:'runtime_not_newer_than_failure'};
  return {action:'requeue',reason:'runtime_source_newer_than_failed_campaign_job'};
}

export function managerJobMaterializationDecision(existingStatus='') {
  const status=String(existingStatus || '').trim().toLowerCase();
  if(!status)return {action:'create',reason:'no_existing_job'};
  if(status==='failed')return {action:'block',reason:'previous_failed_terminal_no_duplicate_job'};
  return {action:'dedupe',reason:`existing_${status}`};
}
