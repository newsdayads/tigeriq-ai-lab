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
