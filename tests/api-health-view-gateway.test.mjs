import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthViewGateway } from '../apps/tigeriq-core/api-health-view-gateway.mjs';

const secret='unit-test-secret-that-is-long-enough-and-not-real';
async function withGateway(fn){
  const calls=[];
  const server=createHealthViewGateway({
    secret,
    fetchImpl: async (url,options)=>{
      calls.push({url,options});
      return new Response(url.includes('/api/status') ? JSON.stringify({ok:true}) : 'DASHBOARD_PC01', {
        headers:{'content-type':url.includes('/api/status')?'application/json':'text/html; charset=utf-8'},
      });
    },
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn('http://127.0.0.1:'+server.address().port,calls);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
test('gateway requires bearer auth and never fetches PC01 without it',async()=>{
  await withGateway(async(base,calls)=>{
    const r=await fetch(base+'/api/status');
    assert.equal(r.status,401); assert.equal(calls.length,0);
  });
});
test('gateway rejects every POST and write-capable API route',async()=>{
  await withGateway(async(base,calls)=>{
    const headers={Authorization:'Bearer '+secret};
    const p=await fetch(base+'/api/status',{method:'POST',headers});
    const r=await fetch(base+'/api/objectives',{headers});
    const q=await fetch(base+'/api/work-history?number=bad',{headers});
    assert.equal(p.status,405);
    assert.equal(r.status,404);
    assert.equal(q.status,400);
    assert.equal(calls.length,0);
  });
});
test('gateway serves PC01 HTML and allowed read-only API only',async()=>{
  await withGateway(async(base,calls)=>{
    const headers={Authorization:'Bearer '+secret};
    const d=await fetch(base+'/',{headers});
    const a=await fetch(base+'/api/status',{headers});
    assert.equal(d.status,200); assert.equal(await d.text(),'DASHBOARD_PC01');
    assert.equal(a.status,200); assert.deepEqual(await a.json(),{ok:true});
    assert.deepEqual(calls.map(x=>new URL(x.url).pathname),['/','/api/status']);
    assert.ok(calls.every(x=>x.options.method==='GET'));
  });
});
test('gateway permits numeric history lookup without forwarding arbitrary query',async()=>{
  await withGateway(async(base,calls)=>{
    const r=await fetch(base+'/api/work-history?number=4708&evil=foo',{
      headers:{Authorization:'Bearer '+secret}});
    assert.equal(r.status,200);
    assert.equal(new URL(calls[0].url).search,'?number=4708');
  });
});
