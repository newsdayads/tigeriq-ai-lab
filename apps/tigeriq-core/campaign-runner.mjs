export function normalizeCampaignPhases(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error('CAMPAIGN_PHASES_INVALID');
  if (input.length === 0) return [];
  if (input.length < 3 || input.length > 12) throw new Error('CAMPAIGN_PHASE_COUNT_INVALID');
  return input.map((phase,index)=>{
    const raw = typeof phase === 'string' ? { title: phase, prompt: phase } : phase;
    const title = String(raw?.title || '').trim();
    const prompt = String(raw?.prompt || raw?.goal || title).trim();
    const acceptance = String(raw?.acceptance || '').trim();
    if (!title || !prompt) throw new Error(`CAMPAIGN_PHASE_INVALID:${index}`);
    return { title: title.slice(0,200), prompt: prompt.slice(0,6000), acceptance: acceptance.slice(0,3000) };
  });
}

export function currentCampaignGoal(objective, phases, currentPhase=0) {
  const list = Array.isArray(phases) ? phases : [];
  if (!list.length) return String(objective || '');
  const index = Math.min(Math.max(Number(currentPhase)||0,0),list.length-1);
  const phase = list[index];
  return [
    String(objective || ''),
    `Campaign phase ${index+1}/${list.length}: ${phase.title}`,
    `Phase task: ${phase.prompt}`,
    phase.acceptance ? `Phase acceptance: ${phase.acceptance}` : ''
  ].filter(Boolean).join('\n');
}

export function campaignTransition({status,currentPhase=0,phases=[]}) {
  const list = Array.isArray(phases) ? phases : [];
  if (status === 'blocked') return { action:'blocked', terminal:true, nextPhase:null };
  if (status === 'continue') return { action:'continue', terminal:false, nextPhase:Number(currentPhase)||0 };
  if (status !== 'complete') throw new Error('CAMPAIGN_STATUS_INVALID');
  if (!list.length) return { action:'complete', terminal:true, nextPhase:null };
  const index = Number(currentPhase)||0;
  if (index < list.length-1) return { action:'advance', terminal:false, nextPhase:index+1 };
  return { action:'complete', terminal:true, nextPhase:null };
}

export function makePhaseCheckpoint({currentPhase=0,phases=[],summary='',completedAt}) {
  const list = Array.isArray(phases) ? phases : [];
  const index = Number(currentPhase)||0;
  return {
    phaseIndex:index,
    phaseNumber:index+1,
    phaseCount:list.length,
    phaseTitle:list[index]?.title || null,
    summary:String(summary||'').slice(0,2000),
    completedAt:completedAt || new Date().toISOString()
  };
}
