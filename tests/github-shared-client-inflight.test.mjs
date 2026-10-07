import { describe, expect, it, vi } from 'vitest';
import { githubRequestJson } from '../apps/tigeriq-core/github-shared-client.mjs';

describe('#4431 GitHub shared inflight dedupe',()=>{
  it('keeps a pending shared request deduped after one caller aborts',async()=>{
    let resolveFetch;
    const fetchImpl=vi.fn(()=>new Promise((resolve)=>{resolveFetch=resolve}));
    const url='https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/4431';
    const caller=new AbortController();

    const first=githubRequestJson(fetchImpl,url,'',{freshMs:0,signal:caller.signal});
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    caller.abort(new Error('CALLER_STOPPED_WAITING'));
    await expect(first).rejects.toThrow('CALLER_STOPPED_WAITING');

    const second=githubRequestJson(fetchImpl,url,'',{freshMs:0});
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({number:4431,state:'open'}),{
      status:200,
      headers:{'content-type':'application/json',etag:'"4431"'},
    }));

    await expect(second).resolves.toMatchObject({number:4431,state:'open'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});


describe('#4439 GitHub shared write abort bounds',()=>{
  it('propagates caller abort through the bounded write signal',async()=>{
    let networkSignal;
    const fetchImpl=vi.fn((_url,init)=>new Promise((_resolve,reject)=>{
      networkSignal=init.signal;
      init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
    }));
    const caller=new AbortController();
    const request=githubRequestJson(fetchImpl,'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/4439','',{
      method:'POST',
      signal:caller.signal,
      body:'{}',
    });
    await Promise.resolve();
    expect(networkSignal).toBeTruthy();
    expect(networkSignal).not.toBe(caller.signal);
    caller.abort(new Error('CALLER_ABORTED_WRITE'));
    await expect(request).rejects.toThrow('CALLER_ABORTED_WRITE');
  });

  it('retains the 12s hard timeout even when the caller provides a signal',async()=>{
    vi.useFakeTimers();
    try{
      let networkSignal;
      const fetchImpl=vi.fn((_url,init)=>new Promise((_resolve,reject)=>{
        networkSignal=init.signal;
        init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
      }));
      const caller=new AbortController();
      const request=githubRequestJson(fetchImpl,'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/4439','',{
        method:'PATCH',
        signal:caller.signal,
        body:'{}',
      });
      await Promise.resolve();
      expect(networkSignal).toBeTruthy();
      expect(networkSignal.aborted).toBe(false);
      const rejected=expect(request).rejects.toMatchObject({name:'TimeoutError'});
      await vi.advanceTimersByTimeAsync(12000);
      await rejected;
      expect(networkSignal.aborted).toBe(true);
      expect(caller.signal.aborted).toBe(false);
    }finally{
      vi.useRealTimers();
    }
  });
});
