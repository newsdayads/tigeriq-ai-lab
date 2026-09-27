const CACHE_TTL_MS=Math.max(250,Number(process.env.TIGERIQ_GITHUB_SHARED_CACHE_MS||2000));
const entries=new Map();
const metrics={network:0,hit:0,deduped:0,notModified:0,errors:0};

function githubError(response,body,raw=''){
  const error=new Error(`GITHUB_HTTP_${response.status}:${String(body?.message||raw||'').slice(0,300)}`);
  error.status=response.status;
  error.retryAfter=response.headers?.get?.('retry-after')||'';
  error.rateLimitRemaining=response.headers?.get?.('x-ratelimit-remaining')||'';
  error.rateLimitReset=response.headers?.get?.('x-ratelimit-reset')||'';
  return error;
}

export function githubHttpCacheStats(){
  return {...metrics,entries:entries.size,ttlMs:CACHE_TTL_MS};
}

export function clearGithubHttpCache(){
  entries.clear();
  for(const key of Object.keys(metrics))metrics[key]=0;
}

export async function githubGetJson(fetchImpl,url,{token='',headers={},ttlMs=CACHE_TTL_MS}={}){
  const key=String(url);
  const now=Date.now();
  const prior=entries.get(key)||null;
  if(prior?.value!==undefined&&now-prior.at<Math.max(0,Number(ttlMs)||0)){
    metrics.hit++;
    return prior.value;
  }
  if(prior?.inflight){
    metrics.deduped++;
    return prior.inflight;
  }
  const request=(async()=>{
    const requestHeaders={...headers};
    if(token&&!requestHeaders.authorization)requestHeaders.authorization=`Bearer ${token}`;
    if(prior?.etag)requestHeaders['if-none-match']=prior.etag;
    metrics.network++;
    let response;
    try{
      response=await fetchImpl(key,{method:'GET',headers:requestHeaders,signal:AbortSignal.timeout(12000)});
      if(response.status===304&&prior?.value!==undefined){
        metrics.notModified++;
        entries.set(key,{...prior,at:Date.now(),inflight:null});
        return prior.value;
      }
      const raw=response.status===204?'':await response.text();
      let body={};
      if(raw){try{body=JSON.parse(raw)}catch{body={text:raw}}}
      if(!response.ok)throw githubError(response,body,raw);
      const value=response.status===204?{}:body;
      entries.set(key,{value,etag:response.headers?.get?.('etag')||prior?.etag||null,at:Date.now(),inflight:null});
      return value;
    }catch(error){
      metrics.errors++;
      if(prior)entries.set(key,{...prior,inflight:null});
      else entries.delete(key);
      throw error;
    }
  })();
  entries.set(key,{...(prior||{}),inflight:request,at:prior?.at||0});
  return request;
}
