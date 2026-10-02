export const STABILITY_V2_RESOURCE_SCOPE='API_WORKFORCE_FUNCTIONAL_STABILITY_V2';
export const STABILITY_V2_EMPLOYEE_ALLOWLIST=Object.freeze(['NV11','NV12','NV13','NV14','NV15','NV16','NV17','NV18','NV19','NV20']);
export const STABILITY_V2_ROUND_MIN_SPACING_MS=300000;

const ROUND_LAYOUT=Object.freeze([
  {round:1,batch1:'general',batch2:'reasoning'},
  {round:2,batch1:'reasoning',batch2:'general'},
  {round:3,batch1:'general',batch2:'reasoning'},
]);

const capLabel=(capability)=>capability==='reasoning'?'Reasoning':'General';
const titleFor=(round,batch,capability,ordinal)=>`STAB-R${round}-${capLabel(capability)}-Batch${batch}-Job${ordinal}`;

export function isStabilityV2ResourceScope(value=''){
  return String(value||'').trim()===STABILITY_V2_RESOURCE_SCOPE;
}

export function stabilityV2EmployeeAllowlist(metadata={}){
  return isStabilityV2ResourceScope(metadata?.resourceScope)?[...STABILITY_V2_EMPLOYEE_ALLOWLIST]:[];
}

export function stabilityV2ExpectedGroups(){
  const groups=[];
  for(const layout of ROUND_LAYOUT){
    groups.push({
      round:layout.round,batch:1,capability:layout.batch1,
      specs:[1,2,3].map(ordinal=>stabilityV2JobSpec(layout.round,1,layout.batch1,ordinal)),
    });
    groups.push({
      round:layout.round,batch:2,capability:layout.batch2,
      specs:[1,2].map(ordinal=>stabilityV2JobSpec(layout.round,2,layout.batch2,ordinal)),
    });
  }
  return groups;
}

export function stabilityV2JobSpec(round,batch,capability,ordinal){
  const title=titleFor(round,batch,capability,ordinal);
  const marker=`STAB_R${round}_B${batch}_J${ordinal}_OK`;
  const prompt=capability==='reasoning'
    ? `TigerIQ Stability V2 normal reasoning work. Compute ${round*100+batch*10+ordinal} + 7. Return "${marker}" followed by the numeric answer and one concise sentence. Do not coordinate, create, or request other jobs.`
    : `TigerIQ Stability V2 normal general work. Return "${marker}" followed by one concise sentence explaining why idempotency prevents duplicate effects. Do not coordinate, create, or request other jobs.`;
  return {round,batch,ordinal,capability,title,prompt,marker};
}

const terminalFailure=(status)=>['failed','blocked','cancelled','canceled'].includes(String(status||'').toLowerCase());
const done=(status)=>String(status||'').toLowerCase()==='done';

function createdMs(row){
  const value=Date.parse(String(row?.created_at||row?.createdAt||row?.started_at||row?.startedAt||''));
  return Number.isFinite(value)?value:NaN;
}

export function stabilityV2Plan({
  resourceScope='',
  jobs=[],
  nowMs=Date.now(),
  lastDeepAuditMs=0,
  roundMinSpacingMs=STABILITY_V2_ROUND_MIN_SPACING_MS,
  cadenceMs=STABILITY_V2_ROUND_MIN_SPACING_MS,
}={}){
  if(!isStabilityV2ResourceScope(resourceScope))return {handled:false};
  const rows=Array.isArray(jobs)?jobs:[];
  const groups=stabilityV2ExpectedGroups();
  const expectedTitles=new Set(groups.flatMap(group=>group.specs.map(spec=>spec.title)));
  const titleGroup=new Map();
  groups.forEach((group,index)=>group.specs.forEach(spec=>titleGroup.set(spec.title,index)));

  const stabRows=rows.filter(row=>String(row?.title||'').startsWith('STAB-R'));
  const malformed=stabRows.filter(row=>!expectedTitles.has(String(row?.title||'')));
  if(malformed.length)return {handled:true,action:'block',reason:'malformed_stability_job',jobIds:malformed.map(row=>row.id).filter(Boolean)};

  const byTitle=new Map();
  for(const row of stabRows){
    const title=String(row.title||'');
    const list=byTitle.get(title)||[];
    list.push(row);
    byTitle.set(title,list);
  }
  const duplicates=[...byTitle.entries()].filter(([,list])=>list.length>1);
  if(duplicates.length)return {handled:true,action:'block',reason:'duplicate_stability_job',titles:duplicates.map(([title])=>title)};

  for(let groupIndex=0;groupIndex<groups.length;groupIndex++){
    const group=groups[groupIndex];
    const groupRows=group.specs.map(spec=>(byTitle.get(spec.title)||[])[0]).filter(Boolean);
    const futureRows=stabRows.filter(row=>(titleGroup.get(String(row.title||''))??-1)>groupIndex);

    if(groupRows.length===0){
      if(futureRows.length)return {handled:true,action:'block',reason:'premature_future_batch',jobIds:futureRows.map(row=>row.id).filter(Boolean)};
      if(group.batch===1&&group.round>1){
        const previousRoundRows=stabRows.filter(row=>String(row.title||'').startsWith(`STAB-R${group.round-1}-`));
        const timestamps=previousRoundRows.map(createdMs).filter(Number.isFinite);
        if(timestamps.length!==5)return {handled:true,action:'block',reason:'previous_round_timestamp_evidence_missing',round:group.round-1};
        const dueAtMs=Math.min(...timestamps)+Math.max(0,Number(roundMinSpacingMs)||0);
        if(Number(nowMs)<dueAtMs){
          return {handled:true,action:'wait',reason:'round_spacing',round:group.round,nextCheckAtMs:dueAtMs,dueAtMs};
        }
        if(Number(lastDeepAuditMs)<dueAtMs){
          const nextCadenceMs=Math.max(Number(nowMs)+5000,Number(lastDeepAuditMs||nowMs)+Math.max(1000,Number(cadenceMs)||0));
          return {handled:true,action:'wait',reason:'deep_audit_cadence_pending',round:group.round,nextCheckAtMs:nextCadenceMs,dueAtMs};
        }
      }
      return {handled:true,action:'materialize',reason:'batch_due',round:group.round,batch:group.batch,capability:group.capability,specs:group.specs};
    }

    if(groupRows.length!==group.specs.length){
      return {handled:true,action:'block',reason:'partial_batch_materialization',round:group.round,batch:group.batch,jobIds:groupRows.map(row=>row.id).filter(Boolean)};
    }
    if(futureRows.length&&!groupRows.every(row=>done(row.status))){
      return {handled:true,action:'block',reason:'premature_future_batch',jobIds:futureRows.map(row=>row.id).filter(Boolean)};
    }
    const terminalFailures=groupRows.filter(row=>terminalFailure(row.status));
    if(terminalFailures.length){
      return {handled:true,action:'block',reason:'terminal_job_failure',round:group.round,batch:group.batch,jobIds:terminalFailures.map(row=>row.id).filter(Boolean)};
    }
    if(!groupRows.every(row=>done(row.status))){
      return {handled:true,action:'wait',reason:'batch_running',round:group.round,batch:group.batch,nextCheckAtMs:Number(nowMs)+5000};
    }

    const specByTitle=new Map(group.specs.map(spec=>[spec.title,spec]));
    const contractMismatch=groupRows.filter(row=>{
      const spec=specByTitle.get(String(row.title||''));
      const text=String(row?.result?.text||'');
      return !spec
        || String(row?.kind||'').toLowerCase()!=='ai'
        || String(row?.capability||'').toLowerCase()!==spec.capability
        || !text.includes(spec.marker);
    });
    if(contractMismatch.length){
      return {handled:true,action:'block',reason:'job_contract_mismatch',round:group.round,batch:group.batch,jobIds:contractMismatch.map(row=>row.id).filter(Boolean)};
    }

    const outOfScope=groupRows.filter(row=>row.employee_id&&!STABILITY_V2_EMPLOYEE_ALLOWLIST.includes(String(row.employee_id).toUpperCase()));
    const outOfScopeAttempts=groupRows.filter(row=>(Array.isArray(row?.result?.failures)?row.result.failures:[]).some(f=>f?.employeeId&&!STABILITY_V2_EMPLOYEE_ALLOWLIST.includes(String(f.employeeId).toUpperCase())));
    if(outOfScope.length||outOfScopeAttempts.length){
      return {handled:true,action:'block',reason:'out_of_scope_employee',round:group.round,batch:group.batch,jobIds:[...new Set([...outOfScope,...outOfScopeAttempts].map(row=>row.id).filter(Boolean))]};
    }
    if(group.batch===1){
      const providers=new Set(groupRows.map(row=>String(row.provider||'').trim()).filter(Boolean));
      if(providers.size!==3){
        return {handled:true,action:'block',reason:'batch1_provider_diversity_failed',round:group.round,batch:group.batch,providers:[...providers]};
      }
    }
  }

  return {handled:true,action:'complete',reason:'three_rounds_complete',rounds:3,totalJobs:15};
}
