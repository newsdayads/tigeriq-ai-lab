// Read-only, source-level decision helper for TigerIQ Core. Never dispatches a job.
// The trusted Core must verify owner grant, authenticated resource and atomic writer lease.
const MAX_AGE_MS=120000;
const safeRatio=n=>Number.isFinite(Number(n))?Math.max(0,Math.min(1,Number(n))):null;
const utc=v=>{const n=Date.parse(String(v||''));return Number.isFinite(n)?n:null;};
const windowRemaining=w=>w&&Number.isFinite(Number(w.usedPercent))?safeRatio(1-Number(w.usedPercent)/100):null;

export function codexQuotaSnapshot(result,{observedAt}={}){
  const source=result?.result??result??{};
  const group=source.rateLimitsByLimitId?.codex??source.rateLimits??source;
  const windows=[group.primary,group.secondary].filter(Boolean);
  const fractions=windows.map(windowRemaining);
  const remaining=fractions.length&&fractions.every(x=>x!==null)?Math.min(...fractions):null;
  return {
    provider:'codex',observedAt:observedAt??null,
    quotaKnown:remaining!==null,remainingFraction:remaining,
    windows:windows.map((w,i)=>({kind:i?'secondary':'primary',remainingFraction:windowRemaining(w),
      resetAt:Number.isFinite(Number(w.resetsAt))?new Date(Number(w.resetsAt)*1000).toISOString():null})),
    blocked:group.rateLimitReachedType!==null&&group.rateLimitReachedType!==undefined||group.spendControlReached===true,
    source:'codex-app-server:account/rateLimits/read'
  };
}

export function antigravityQuotaSnapshots(result,{observedAt}={}){
  const data=result?.command?.data??result?.result?.command?.data;
  if(result?.status!=='SUCCESS'||result?.command?.name!=='usage'||!Array.isArray(data?.groups))return [];
  return data.groups.map(g=>{
    const buckets=Array.isArray(g.buckets)?g.buckets:[];
    const fractions=buckets.map(b=>safeRatio(b.remaining_fraction));
    const remaining=fractions.length&&fractions.every(x=>x!==null)?Math.min(...fractions):null;
    return {provider:'antigravity',group:String(g.name||''),observedAt:observedAt??null,
      quotaKnown:remaining!==null,remainingFraction:remaining,
      windows:buckets.map(b=>({kind:String(b.window||''),remainingFraction:safeRatio(b.remaining_fraction),resetAt:b.reset_time||null})),
      blocked:remaining!==null&&remaining<=0,source:'agy:/usage'};
  });
}

const GROUPS=[
  {group:'Gemini Models',preferred:['gemini-3.8-flash-low','gemini-4-hydrogen-medium','gemini-4-neon-high']},
  {group:'Claude and GPT models',preferred:['claude-sonnet-5-5-medium','claude-opus-5-5-high','gpt-oss-120b-medium']},
  {group:'Gemini 4 Argon',preferred:['gemini-4-argon-medium','gemini-4-argon-high']}
];
const DIFFICULTY={
  LOW:['gemini-3.8-flash-low','gemini-4-hydrogen-medium','claude-sonnet-5-5-medium'],
  MEDIUM:['gemini-4-hydrogen-medium','gemini-4-neon-high','claude-sonnet-5-5-medium','gemini-3.8-flash-low'],
  HIGH:['gemini-4-neon-high','claude-opus-5-5-high','claude-sonnet-5-5-medium','gemini-4-hydrogen-medium']
};
const available=(snapshot,nowMs)=>snapshot?.quotaKnown===true&&snapshot.blocked!==true
  &&snapshot.remainingFraction!==null&&snapshot.remainingFraction>0.05
  &&utc(snapshot.observedAt)!==null&&utc(snapshot.observedAt)<=nowMs
  &&nowMs-utc(snapshot.observedAt)<=MAX_AGE_MS;
function modelGroup(model){return GROUPS.find(g=>g.preferred.includes(model))?.group||null;}

// Returns a recommendation, not a dispatch receipt. Codex requires a verified,
// job-specific Owner approval passed by the trusted caller. There is no paid fallback.
export function chooseOwnerCodingRoute({
  job={},snapshots=[],antigravityModels=[],codexModels=[],auth={},nowMs=Date.now()
}={}){
  const id=String(job.id||''),scope=String(job.resourceScope||'');
  if(!id||!scope||job.priority==='P0')return {chosen:null,code:'JOB_SCOPE_REQUIRED'};
  const task=String(job.difficulty||'MEDIUM').toUpperCase();
  const preference=DIFFICULTY[task]||DIFFICULTY.MEDIUM;
  const agyNames=new Set((Array.isArray(antigravityModels)?antigravityModels:[]).map(String));
  const quota=(Array.isArray(snapshots)?snapshots:[]).filter(s=>available(s,nowMs));
  const agyCandidates=[];
  if(auth.antigravity===true){
    for(const model of preference){
      if(!agyNames.has(model))continue;
      const group=modelGroup(model);
      const s=quota.find(x=>x.provider==='antigravity'&&x.group===group);
      if(s)agyCandidates.push({provider:'antigravity',model,remainingFraction:s.remainingFraction,group,source:s.source});
    }
  }
  if(agyCandidates.length)return {chosen:agyCandidates[0],code:'ELIGIBLE_NOT_DISPATCHED'};
  const grant=job.codexGrant;
  const codexApproved=auth.codex===true&&grant?.approved===true&&grant.jobId===id&&grant.resourceScope===scope;
  if(codexApproved){
    const s=quota.find(x=>x.provider==='codex');
    const models=(Array.isArray(codexModels)?codexModels:[]).filter(x=>typeof x==='string'&&x.trim());
    if(s&&models.length){
      const choice=task==='LOW'?models.find(m=>/mini|spark|small/i.test(m)):models.find(m=>/codex|gpt/i.test(m));
      const model=choice||models[0];
      return {chosen:{provider:'codex',model,remainingFraction:s.remainingFraction,source:s.source},code:'ELIGIBLE_NOT_DISPATCHED'};
    }
  }
  return {chosen:null,code:'NO_VERIFIED_AUTHORIZED_QUOTA'};
}
