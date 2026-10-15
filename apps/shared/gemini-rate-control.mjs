const defaultSleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

export function isGeminiRateLimitError(error){
  const status=Number(error?.status||0);
  const message=String(error?.message||error||'');
  return status===429||/HTTP_429|RESOURCE_EXHAUSTED|RATE_LIMIT/i.test(message);
}

// Gemini Free RPD is a project quota, not a key expiry. Stop retrying
// known daily 429s until the provider's Pacific-midnight reset.
export function isGeminiDailyQuotaError(error){
  if(!isGeminiRateLimitError(error))return false;
  const details=JSON.stringify(error?.body?.error?.details||error?.body?.details||[]).slice(0,5000);
  const message=String(error?.body?.error?.message||error?.message||'').slice(0,3000);
  return /requests?_?per_?day|requests? per day|\bRPD\b|daily\s+(?:quota|limit)|GenerateRequestsPerDay/i.test(details+' '+message);
}

function pacificOffsetMinutes(utcMs){
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'shortOffset',year:'numeric',month:'2-digit',day:'2-digit'});
  const text=fmt.formatToParts(new Date(utcMs)).find(p=>p.type==='timeZoneName')?.value||'';
  const match=text.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if(!match)throw new Error('PACIFIC_TIMEZONE_UNAVAILABLE');
  const offset=Number(match[2])*60+Number(match[3]||0);
  return (match[1]==='-'?-1:1)*offset;
}
export function nextGeminiDailyResetUtc(nowMs=Date.now()){
  const now=Number(nowMs);
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
  const parts=Object.fromEntries(fmt.formatToParts(new Date(now)).filter(p=>['year','month','day'].includes(p.type)).map(p=>[p.type,Number(p.value)]));
  const targetLocal=Date.UTC(parts.year,parts.month-1,parts.day+1);
  let targetUtc=targetLocal-pacificOffsetMinutes(now)*60000;
  for(let i=0;i<3;i++)targetUtc=targetLocal-pacificOffsetMinutes(targetUtc)*60000;
  return new Date(targetUtc).toISOString();
}

export function exponentialBackoffDelay(attemptIndex,{baseMs=4500,maxMs=60000}={}){
  const index=Math.max(0,Number(attemptIndex)||0);
  const base=Math.max(1,Number(baseMs)||4500);
  const max=Math.max(base,Number(maxMs)||60000);
  return Math.min(max,base*Math.pow(2,index));
}

export function createGeminiRateController({minIntervalMs=4500,maxAttempts=4,backoffBaseMs=4500,maxBackoffMs=60000,nowFn=Date.now,sleepFn=defaultSleep}={}){
  const minInterval=Math.max(4500,Number(minIntervalMs)||4500);
  const attempts=Math.max(1,Number(maxAttempts)||4);
  let lastStartedAt=null;
  let dailyBlockedUntilMs=0;
  let tail=Promise.resolve();

  const execute=async(call)=>{
    for(let attemptIndex=0;attemptIndex<attempts;attemptIndex++){
      const now=Number(nowFn());
      if(now<dailyBlockedUntilMs){
        const error=Object.assign(new Error('GEMINI_DAILY_QUOTA_WAIT'),{
          kind:'rate_limit',status:429,geminiDailyQuota:true,
          cooldownUntil:new Date(dailyBlockedUntilMs).toISOString(),
        });
        throw error;
      }
      if(lastStartedAt!==null){
        const waitMs=Math.max(0,minInterval-(now-lastStartedAt));
        if(waitMs>0)await sleepFn(waitMs);
      }
      lastStartedAt=Number(nowFn());
      try{return await call({attempt:attemptIndex+1,maxAttempts:attempts});}
      catch(error){
        if(!isGeminiRateLimitError(error))throw error;
        if(isGeminiDailyQuotaError(error)){
          dailyBlockedUntilMs=Math.max(dailyBlockedUntilMs,Date.parse(nextGeminiDailyResetUtc(nowFn())));
          error.geminiDailyQuota=true;
          error.cooldownUntil=new Date(dailyBlockedUntilMs).toISOString();
          throw error;
        }
        if(attemptIndex>=attempts-1){error.geminiRetryExhausted=true;throw error;}
        await sleepFn(exponentialBackoffDelay(attemptIndex,{baseMs:backoffBaseMs,maxMs:maxBackoffMs}));
      }
    }
    throw new Error('GEMINI_RETRY_EXHAUSTED');
  };

  return {
    run(call){
      const task=tail.then(()=>execute(call),()=>execute(call));
      tail=task.then(()=>undefined,()=>undefined);
      return task;
    },
  };
}
