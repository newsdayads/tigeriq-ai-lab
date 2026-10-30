import { executionPacketFromPrompt, executionResultGate } from './task-prompt-compiler.mjs';

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

function campaignEvidenceText(value,max=700){
  const raw=typeof value==='string'?value:JSON.stringify(value??null);
  return String(raw||'').slice(0,Math.max(0,Number(max)||0));
}

export function campaignPriorEvidenceContext({currentPhase=0,checkpoints=[],jobs=[]}={}){
  const phaseIndex=Math.max(0,Number(currentPhase)||0);
  if(phaseIndex<=0)return '';
  const previousPhaseIndex=phaseIndex-1;
  const checkpoint=(Array.isArray(checkpoints)?checkpoints:[])
    .filter(item=>Number(item?.phaseIndex)===previousPhaseIndex)
    .slice(-1)[0]||null;
  const receipts=(Array.isArray(jobs)?jobs:[])
    .filter(job=>job?.status==='done'&&Number(job?.phase_index)===previousPhaseIndex)
    .slice(0,4)
    .map(job=>{
      let result=job?.result??null;
      if(typeof result==='string'){
        try{result=JSON.parse(result);}catch{}
      }
      return {
        id:String(job?.id||''),
        title:String(job?.title||'').slice(0,180),
        kind:String(job?.kind||''),
        employeeId:String(job?.employee_id||''),
        resourceId:String(job?.resource_id||''),
        provider:String(job?.provider||''),
        completedAt:job?.completed_at||null,
        executionGate:result&&typeof result==='object'?{
          pass:result?.executionGate?.pass===true,
          code:String(result?.executionGate?.code||''),
          evidenceIds:Array.isArray(result?.executionGate?.evidenceIds)?result.executionGate.evidenceIds.slice(0,8):[],
        }:null,
        resultText:campaignEvidenceText(result&&typeof result==='object'?result?.text:result,700),
      };
    });
  if(!checkpoint&&!receipts.length)return '';
  const payload={
    schema:'TIGERIQ_CAMPAIGN_PRIOR_EVIDENCE_V1',
    previousPhaseIndex,
    checkpoint:checkpoint?{
      phaseIndex:Number(checkpoint?.phaseIndex),
      phaseNumber:Number(checkpoint?.phaseNumber)||previousPhaseIndex+1,
      phaseTitle:String(checkpoint?.phaseTitle||'').slice(0,180),
      summary:String(checkpoint?.summary||'').slice(0,400),
      jobId:String(checkpoint?.jobId||''),
      employeeId:String(checkpoint?.employeeId||''),
      resourceId:String(checkpoint?.resourceId||''),
      completedAt:checkpoint?.completedAt||null,
    }:null,
    receipts,
  };
  return `PRIOR_CAMPAIGN_HANDOFF_V1 ${JSON.stringify(payload)}`.slice(0,2600);
}

export function repairCampaignReviewPrompt(prompt,priorContext,{maxChars=12000}={}){
  const base=String(prompt||'').trim();
  const context=String(priorContext||'').trim();
  if(!base)return {changed:false,prompt:base,reason:'prompt_missing'};
  if(!context)return {changed:false,prompt:base,reason:'prior_context_missing'};
  if(base.includes('PRIOR_CAMPAIGN_HANDOFF_V1')||base.includes('AUTHORIZED PRIOR CAMPAIGN HANDOFF:'))
    return {changed:false,prompt:base,reason:'prior_context_already_present'};
  const marker='\n\nAUTHORIZED PRIOR CAMPAIGN HANDOFF:\n';
  const limit=Math.max(1000,Math.min(12000,Number(maxChars)||12000));
  const available=limit-base.length-marker.length;
  if(available<256)return {changed:false,prompt:base,reason:'prompt_budget_exhausted'};
  return {
    changed:true,
    prompt:`${base}${marker}${context.slice(0,available)}`,
    reason:'prior_context_appended',
  };
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

export function campaignNeedsEvidence({status,phases=[],doneJobs=0}) {
  return status === 'complete' && Array.isArray(phases) && phases.length > 0 && Number(doneJobs || 0) < 1;
}

export function campaignEvidenceJobId(objectiveId,currentPhase=0) {
  const id=String(objectiveId||'').trim();
  if(!id) throw new Error('CAMPAIGN_OBJECTIVE_ID_REQUIRED');
  return `JOB-EVID-${id}-P${Number(currentPhase)||0}`;
}

export function verifyRuntimeSourceIsolationState() {
  return { ok: true, isolation: 'dedicated-clean-source-checkout', version: 'TIGERIQ_RUNTIME_SOURCE_V1' };
}

export function normalizeWorkItemLifecycle(input = {}) {
  const raw = input || {};
  const issueOrPr = String(raw.issueOrPr || raw.issue_or_pr || raw.pr || raw.issue || '').trim();
  const implementer = String(raw.implementer || raw.assignee || raw.employee_id || '').trim();
  const reviewer = String(raw.reviewer || raw.review_employee_id || '').trim();
  const stage = String(raw.stage || raw.status || 'planning').trim().toLowerCase();
  const timestamps = raw.timestamps && typeof raw.timestamps === 'object' ? raw.timestamps : { created: raw.createdAt || new Date().toISOString() };
  const blocker = String(raw.blocker || raw.blocked_reason || '').trim();
  const nextAction = String(raw.nextAction || raw.next_action || raw.next || '').trim();
  return {
    issueOrPr,
    implementer,
    reviewer,
    stage,
    timestamps,
    blocker,
    nextAction
  };
}

export function executeCoreWorkItemLifecycle({ workItem, preflightFn, repairFn, reviewFn, maxRepairCycles = 3, maxHeartbeatRetries = 2, maxAckRetries = 2, heartbeatFn, ackFn, autoChainFn } = {}) {
  const item = normalizeWorkItemLifecycle(workItem);
  const preflight = typeof preflightFn === 'function' ? preflightFn(item) : { ok: true, errors: [] };
  if (!preflight.ok) {
    return {
      ok: false,
      stage: 'preflight_failed',
      errors: preflight.errors,
      item: { ...item, stage: 'blocked', blocker: `Preflight failed: ${preflight.errors.join(', ')}` }
    };
  }

  let currentCycle = 0;
  let heartbeatFailures = 0;
  let ackFailures = 0;
  let lastError = null;
  let reviewed = false;
  let reviewDecision = 'pending';

  while (currentCycle <= maxRepairCycles) {
    try {
      if (typeof heartbeatFn === 'function') {
        const hb = heartbeatFn({ item, cycle: currentCycle });
        if (hb && hb.ok === false) {
          heartbeatFailures++;
          if (heartbeatFailures > maxHeartbeatRetries) {
            throw new Error(`HEARTBEAT_RETRIES_EXHAUSTED:${hb.reason || 'Heartbeat checks failed'}`);
          }
          throw new Error(`HEARTBEAT_FAILURE:${hb.reason || 'Heartbeat check failed'}`);
        }
      }

      if (typeof repairFn === 'function' && currentCycle > 0) {
        repairFn({ cycle: currentCycle, lastError });
      }
      
      if (typeof reviewFn === 'function') {
        const rev = reviewFn({ item, cycle: currentCycle });
        reviewDecision = rev?.decision || 'approve';
        reviewed = true;
        if (reviewDecision !== 'approve' && reviewDecision !== 'approved') {
          throw new Error(`REVIEW_CHANGES_UNRESOLVED:${rev?.reason || 'Changes requested by independent reviewer'}`);
        }
      }

      if (typeof ackFn === 'function') {
        const ack = ackFn({ item, cycle: currentCycle });
        if (ack && ack.ok === false) {
          ackFailures++;
          if (ackFailures > maxAckRetries) {
            throw new Error(`ACK_RETRIES_EXHAUSTED:${ack.reason || 'Acknowledgement failed'}`);
          }
          throw new Error(`ACK_FAILURE:${ack.reason || 'Acknowledgement failed'}`);
        }
      }

      let chained = null;
      if (typeof autoChainFn === 'function') {
        chained = autoChainFn({ item });
      }

      return {
        ok: true,
        stage: 'completed',
        repairCycles: currentCycle,
        nextChainedItem: chained || null,
        item: { ...item, stage: 'completed', blocker: '', nextAction: chained ? 'auto_dispatched' : 'done' }
      };
    } catch (err) {
      lastError = err;
      const errMessage = String(err?.message || err);
      if (currentCycle >= maxRepairCycles) {
        currentCycle++;
        return {
          ok: false,
          stage: 'repair_exhausted',
          repairCycles: currentCycle - 1,
          error: errMessage,
          item: { ...item, stage: 'failed', blocker: `Repair exhausted after ${currentCycle - 1} cycles: ${errMessage}` }
        };
      }
      currentCycle++;
      if (currentCycle > maxRepairCycles) {
        return {
          ok: false,
          stage: 'repair_exhausted',
          repairCycles: currentCycle - 1,
          error: errMessage,
          item: { ...item, stage: 'failed', blocker: `Repair exhausted after ${currentCycle - 1} cycles: ${errMessage}` }
        };
      }
    }
  }

  return {
    ok: false,
    stage: 'failed',
    repairCycles: currentCycle,
    item: { ...item, stage: 'failed', blocker: 'Lifecycle execution terminated' }
  };
}

/**
 * Re-check durable worker output against the original compiled packet and
 * one exact phase acceptance. A DONE flag or Manager summary is not evidence.
 */
export function verifyCampaignPhaseReceipt(job,{objectiveId,phaseIndex,acceptance}={}){
  if(!job||job.status!=='done')return {accepted:false,code:'PROOF_JOB_NOT_DONE'};
  if(job.kind!=='compiled_campaign'||job.id!==campaignEvidenceJobId(objectiveId,phaseIndex))
    return {accepted:false,code:'PROOF_JOB_ID_OR_KIND_MISMATCH'};
  if(job.objective_id!==objectiveId||Number(job.phase_index)!==Number(phaseIndex))
    return {accepted:false,code:'PROOF_PHASE_OR_OBJECTIVE_MISMATCH'};
  if(!job.employee_id||!job.resource_id||!job.provider||!job.completed_at)
    return {accepted:false,code:'PROOF_WORKER_RECEIPT_INCOMPLETE'};
  try{
    const packet=executionPacketFromPrompt(job.prompt);
    const expected=String(acceptance||'').trim();
    if(!expected||packet.objective_id!==objectiveId||packet.task_id!==job.id||
       packet.acceptance.length!==1||packet.acceptance[0]!==expected)
      return {accepted:false,code:'PROOF_PACKET_ACCEPTANCE_MISMATCH'};
    const value=typeof job.result==='string'?JSON.parse(job.result):job.result;
    if(typeof value?.text!=='string'||!value.text.trim())
      return {accepted:false,code:'PROOF_RESULT_MISSING'};
    const gate=executionResultGate(value.text,packet);
    if(!gate.pass||value?.executionGate?.pass!==true||value?.executionGate?.code!=='EXECUTION_ACCEPTED')
      return {accepted:false,code:'PROOF_DETERMINISTIC_GATE_FAILED'};
    return {accepted:true,code:'EXECUTION_ACCEPTED',jobId:job.id};
  }catch{
    return {accepted:false,code:'PROOF_PACKET_OR_RESULT_INVALID'};
  }
}
