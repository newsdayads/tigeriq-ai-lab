// Recover only authenticated/relevant Core Continuous Verify receipts.
// This is a bounded, fail-closed projection of durable events, not a new queue
// or a substitute for GitHub OIDC admission.
const SHA=/^[a-f0-9]{40}$/i;
const VALID_KIND=new Set(['GITHUB_MAIN_PUSH','GITHUB_MAIN_MERGE','RUNTIME_SHA_CHANGE']);
const HORIZON_MS=24*60*60*1000;
export const CONTINUOUS_VERIFY_RECOVERY_EVENT_LIMIT=1200;
export const CONTINUOUS_VERIFY_RECOVERY_BATCH_LIMIT=16;

function candidateFrom(row){
  const data=row?.data&&typeof row.data==='object'?row.data:{};
  const info=row.type==='GITHUB_EVENT_RECEIVED'?data.continuousVerifyTrigger:data;
  if(!info||typeof info!=='object')return null;
  const kind=String(info.kind||''),key=String(info.key||'');
  if(!VALID_KIND.has(kind))return null;
  const prefix=kind==='RUNTIME_SHA_CHANGE'?'runtime:':'github-main:';
  if(!key.startsWith(prefix)||!SHA.test(key.slice(prefix.length)))return null;
  const sha=key.slice(prefix.length);
  if(kind==='RUNTIME_SHA_CHANGE'){
    // A runtime recovery must prove the installed revision in the durable receipt.
    // The key alone is not source identity; missing currentSha fails closed.
    if(info.currentSha!==sha)return null;
    return {trigger:true,kind,key,currentSha:sha};
  }
  if(info.sourceSha!==sha)return null;
  return {trigger:true,kind,key,sourceSha:sha};
}

export function planContinuousVerifyRecovery(rows,{
  nowMs=Date.now(),horizonMs=HORIZON_MS,batchLimit=CONTINUOUS_VERIFY_RECOVERY_BATCH_LIMIT,
}={}){
  const cutoff=nowMs-Math.min(Math.max(1,Number(horizonMs)||HORIZON_MS),HORIZON_MS);
  const terminals=new Set(),failedAttempt0=new Set(),seen=new Map();
  // Reorder independently of provider query ordering, preserving first receipt.
  for(const row of Array.isArray(rows)?rows:[]){
    const age=Date.parse(row?.ts);
    if(!Number.isFinite(age)||age<cutoff||age>nowMs+60000)continue;
    const type=String(row.type||'');
    if(type==='CONTINUOUS_VERIFY_RUN'||type==='CONTINUOUS_VERIFY_RUN_FAILED'){
      const key=String(row.data?.key||'');
      if(!/^(github-main:|runtime:)[a-f0-9]{40}$/i.test(key))continue;
      if(type==='CONTINUOUS_VERIFY_RUN'||Number(row.data?.attempt||0)>=1)terminals.add(key);
      else failedAttempt0.add(key);
      continue;
    }
    if(type!=='GITHUB_EVENT_RECEIVED'&&type!=='CONTINUOUS_VERIFY_TRIGGER_QUEUED')continue;
    const trigger=candidateFrom(row);
    if(!trigger)continue;
    const seq=Number(row.seq);
    if(!Number.isSafeInteger(seq)||seq<=0)continue;
    const prior=seen.get(trigger.key);
    if(!prior||seq<prior.seq)seen.set(trigger.key,{seq,trigger});
  }
  const max=Math.max(1,Math.min(32,Number(batchLimit)||CONTINUOUS_VERIFY_RECOVERY_BATCH_LIMIT));
  return [...seen.values()].filter(item=>!terminals.has(item.trigger.key))
    .sort((a,b)=>a.seq-b.seq).slice(0,max)
    .map(({trigger})=>({...trigger,attempt:failedAttempt0.has(trigger.key)?1:0}));
}
