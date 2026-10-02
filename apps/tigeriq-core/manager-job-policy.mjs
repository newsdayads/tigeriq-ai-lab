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

export function managerJobMaterializationDecision(existingStatus='') {
  const status=String(existingStatus || '').trim().toLowerCase();
  if(!status)return {action:'create',reason:'no_existing_job'};
  if(status==='failed')return {action:'create',reason:'previous_failed'};
  return {action:'dedupe',reason:`existing_${status}`};
}
