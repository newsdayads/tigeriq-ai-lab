import {beforeEach,describe,expect,it,vi} from 'vitest';
import {clearGithubHttpCache,githubGetJson,githubHttpCacheStats} from '../apps/tigeriq-core/github-http-cache.mjs';
import {githubEventBusStatus,notifyGithubEvent,registerGithubWake} from '../apps/tigeriq-core/github-event-bus.mjs';

describe('GitHub shared HTTP cache',()=>{
  beforeEach(()=>clearGithubHttpCache());
  it('deduplicates concurrent GET requests',async()=>{
    let calls=0;
    const fetchImpl=vi.fn(async()=>{
      calls++;
      await new Promise(r=>setTimeout(r,5));
      return new Response(JSON.stringify([{number:1}]),{status:200,headers:{etag:'"v1"','content-type':'application/json'}});
    });
    const url='https://api.github.test/issues';
    const [a,b]=await Promise.all([githubGetJson(fetchImpl,url),githubGetJson(fetchImpl,url)]);
    expect(a).toEqual([{number:1}]);
    expect(b).toEqual([{number:1}]);
    expect(calls).toBe(1);
    expect(githubHttpCacheStats().deduped).toBeGreaterThanOrEqual(1);
  });
  it('uses ETag revalidation after ttl',async()=>{
    let calls=0;
    const fetchImpl=vi.fn(async(_url,init)=>{
      calls++;
      if(calls===1)return new Response(JSON.stringify({ok:true}),{status:200,headers:{etag:'"v1"'}});
      expect(init.headers['if-none-match']).toBe('"v1"');
      return new Response(null,{status:304,headers:{etag:'"v1"'}});
    });
    const url='https://api.github.test/rate-safe';
    expect(await githubGetJson(fetchImpl,url,{ttlMs:0})).toEqual({ok:true});
    expect(await githubGetJson(fetchImpl,url,{ttlMs:0})).toEqual({ok:true});
    expect(calls).toBe(2);
    expect(githubHttpCacheStats().notModified).toBe(1);
  });
});

describe('GitHub event bus',()=>{
  it('wakes all registered consumers',async()=>{
    const seen=[];
    const offA=registerGithubWake((event)=>seen.push('a:'+event.deliveryId));
    const offB=registerGithubWake((event)=>seen.push('b:'+event.deliveryId));
    const out=await notifyGithubEvent({deliveryId:'d1'});
    offA();offB();
    expect(out.errors).toBe(0);
    expect(out.wakeCount).toBeGreaterThanOrEqual(2);
    expect(seen).toContain('a:d1');
    expect(seen).toContain('b:d1');
    expect(githubEventBusStatus().lastDeliveryId).toBe('d1');
  });
});
