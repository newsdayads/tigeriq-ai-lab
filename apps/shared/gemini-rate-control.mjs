const defaultSleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

export function isGeminiRateLimitError(error){
  const status=Number(error?.status||0);
  const message=String(error?.message||error||'');
  return status===429||/HTTP_429|RESOURCE_EXHAUSTED|RATE_LIMIT/i.test(message);
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
  let tail=Promise.resolve();

  const execute=async(call)=>{
    for(let attemptIndex=0;attemptIndex<attempts;attemptIndex++){
      const now=Number(nowFn());
      if(lastStartedAt!==null){
        const waitMs=Math.max(0,minInterval-(now-lastStartedAt));
        if(waitMs>0)await sleepFn(waitMs);
      }
      lastStartedAt=Number(nowFn());
      try{return await call({attempt:attemptIndex+1,maxAttempts:attempts});}
      catch(error){
        if(!isGeminiRateLimitError(error))throw error;
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
