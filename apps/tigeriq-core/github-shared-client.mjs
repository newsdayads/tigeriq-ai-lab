const cache=new Map();
const inflight=new Map();
const fetchIds=new WeakMap();
let nextFetchId=1;
function fetchIdentity(fetchImpl){if((typeof fetchImpl!=='function'&&typeof fetchImpl!=='object')||fetchImpl===null)return 'default';if(!fetchIds.has(fetchImpl))fetchIds.set(fetchImpl,nextFetchId++);return String(fetchIds.get(fetchImpl))}
const DEFAULT_FRESH_MS=Number(process.env.TIGERIQ_GITHUB_SHARED_CACHE_MS||10000);
const RATE_LIMIT_LOW_WATERMARK=Math.max(0,Number(process.env.TIGERIQ_GITHUB_LOW_WATERMARK||200));
const RATE_LIMIT_SAFETY_MS=Math.max(1000,Number(process.env.TIGERIQ_GITHUB_RESET_SAFETY_MS||5000));
let blockedUntil=0;
const stats={requests:0,network:0,memoryHits:0,notModified:0,writes:0,backoffHits:0,staleHits:0,lastRemaining:null,lastReset:null,lastRequestAt:null};

function makeError(status,body,raw,headers){
  const error=new Error(`GITHUB_HTTP_${status}:${String(body?.message||raw||'').slice(0,300)}`);
  error.status=status;
  error.retryAfter=headers?.get?.('retry-after')||'';
  error.rateLimitRemaining=headers?.get?.('x-ratelimit-remaining')||'';
  error.rateLimitReset=headers?.get?.('x-ratelimit-reset')||'';
  return error;
}

function rateResetMs(headers){
  const reset=Number(headers?.get?.('x-ratelimit-reset'));
  return Number.isFinite(reset)&&reset>0?reset*1000:0;
}
function updateRate(headers){
  const remaining=headers?.get?.('x-ratelimit-remaining');
  const reset=headers?.get?.('x-ratelimit-reset');
  if(remaining!=null)stats.lastRemaining=remaining;
  if(reset!=null)stats.lastReset=reset;
  stats.lastRequestAt=new Date().toISOString();
  const remainingNumber=Number(remaining);
  const resetMs=rateResetMs(headers);
  if(Number.isFinite(remainingNumber)&&remainingNumber<=RATE_LIMIT_LOW_WATERMARK&&resetMs>Date.now())blockedUntil=Math.max(blockedUntil,resetMs+RATE_LIMIT_SAFETY_MS);
}
function applyRateLimitFailure(response,body,raw){
  const message=String(body?.message||raw||'');
  const remaining=Number(response?.headers?.get?.('x-ratelimit-remaining'));
  const limited=response?.status===429||(response?.status===403&&(remaining===0||/rate limit exceeded/i.test(message)));
  if(!limited)return false;
  const retryAfter=Number(response?.headers?.get?.('retry-after'));
  const resetMs=rateResetMs(response?.headers);
  const fallback=Date.now()+Math.max(60000,Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:15*60*1000);
  blockedUntil=Math.max(blockedUntil,resetMs>Date.now()?resetMs+RATE_LIMIT_SAFETY_MS:fallback);
  return true;
}
function backoffError(){
  const error=new Error('GITHUB_RATE_LIMIT_BACKOFF_ACTIVE');
  error.code='GITHUB_RATE_LIMIT_BACKOFF_ACTIVE';
  error.blockedUntil=blockedUntil;
  return error;
}

export async function githubRequestJson(fetchImpl,url,token='',init={}){
  const method=String(init.method||'GET').toUpperCase();
  const headers={
    accept:'application/vnd.github+json',
    'user-agent':'TigerIQ-GitHub-Shared/1.0',
    'x-github-api-version':'2022-11-28',
    ...(init.headers||{}),
  };
  if(token)headers.authorization=`Bearer ${token}`;
  stats.requests++;
  if(method!=='GET'){
    if(blockedUntil>Date.now()){stats.backoffHits++;throw backoffError()}
    stats.writes++;stats.network++;
    const response=await fetchImpl(url,{...init,method,headers,signal:init.signal||AbortSignal.timeout(12000)});
    updateRate(response.headers);
    const raw=response.status===204?'':await response.text();
    let body={};if(raw){try{body=JSON.parse(raw)}catch{body={text:raw}}}
    if(!response.ok){applyRateLimitFailure(response,body,raw);throw makeError(response.status,body,raw,response.headers)}
    return response.status===204?{}:body;
  }

  const key=fetchIdentity(fetchImpl)+':'+String(url);
  const now=Date.now();
  const prior=cache.get(key);
  if(blockedUntil>now){
    stats.backoffHits++;
    if(prior){stats.staleHits++;return prior.body}
    throw backoffError();
  }
  const freshMs=Math.max(0,Number(init.freshMs??DEFAULT_FRESH_MS));
  if(prior&&now-prior.at<freshMs){stats.memoryHits++;return prior.body}
  if(inflight.has(key))return inflight.get(key);

  const request=(async()=>{
    const conditional={...headers};
    if(prior?.etag)conditional['if-none-match']=prior.etag;
    stats.network++;
    const response=await fetchImpl(url,{...init,method:'GET',headers:conditional,signal:init.signal||AbortSignal.timeout(12000)});
    updateRate(response.headers);
    if(response.status===304&&prior){
      stats.notModified++;
      prior.at=Date.now();
      cache.set(key,prior);
      return prior.body;
    }
    const raw=await response.text();
    let body={};if(raw){try{body=JSON.parse(raw)}catch{body={text:raw}}}
    if(!response.ok){
      const limited=applyRateLimitFailure(response,body,raw);
      if(limited&&prior){stats.staleHits++;return prior.body}
      throw makeError(response.status,body,raw,response.headers);
    }
    cache.set(key,{at:Date.now(),etag:response.headers?.get?.('etag')||'',body});
    return body;
  })();
  inflight.set(key,request);
  try{return await request}finally{inflight.delete(key)}
}

export function invalidateGithubCache(match=''){
  const needle=String(match||'');
  for(const key of cache.keys())if(!needle||key.includes(needle))cache.delete(key);
}

export function githubTransportSnapshot(){
  return {...stats,cacheEntries:cache.size,inflight:inflight.size,freshMs:DEFAULT_FRESH_MS,lowWatermark:RATE_LIMIT_LOW_WATERMARK,blockedUntil:blockedUntil?new Date(blockedUntil).toISOString():null,backoffActive:blockedUntil>Date.now()};
}
