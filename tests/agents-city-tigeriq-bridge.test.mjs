import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCoreSnapshot, fetchCoreSnapshot, CORE_URL} from '../apps/agents-city-tigeriq/core-readonly.mjs';
import {createAnimalCityServer} from '../apps/agents-city-tigeriq/server.mjs';

const NOW = Date.parse('2026-10-29T03:00:00.000Z');
function source(now = NOW) {
  return {
    ok:true,updatedAt:new Date(now).toISOString(),
    sourceScope:{openComplete:true,closedHistoryComplete:true},
    items:[
      {number:5424,title:'Core Bridge <script>alert(1)</script>',state:'open',priority:'P1',
        resourceScope:'TIGERIQ_ENGINEERING_APP',currentStep:'R01',nextAction:'Build tests',
        progressCompleted:1,progressTotal:2,progressSteps:[
          {checked:true,evidenceUrls:['https://github.com/newsdayads/tigeriq-ai-lab/issues/5424']},
          {checked:false,evidenceUrls:[]}
        ],
        html_url:'https://evil.example/steal'},
      {number:5290,title:'Canary accepted',state:'closed',priority:'P2',
        bucket:'HOÀN THÀNH',completionSyncState:'DONE_VERIFIED',
        resourceScope:'TIGERIQ_QA',progressCompleted:1,progressTotal:1,
        progressSteps:[{checked:true,evidenceUrls:['https://github.com/example/check']}]},
      {number:5252,title:'Administrative closure',state:'closed',priority:'P1',
        bucket:'ĐÓNG KHÁC',completionSyncState:'PLAN_SHOWN',
        resourceScope:'TIGERIQ_CORE'}
    ]
  };
}

test('maps real Core cards but never invents worker, delegated job or done',()=>{
  const p=normalizeCoreSnapshot(source(),{now:NOW});
  assert.equal(p.ok,true);
  assert.equal(p.readOnly,true);
  assert.equal(p.dispatchEnabled,false);
  assert.equal(p.employeeBindingsVerified,false);
  assert.equal(p.total,3);
  const engineering=p.rooms.find(r=>r.id==='engineering').items[0];
  assert.equal(engineering.id,5424);
  assert.equal(engineering.link,'https://github.com/newsdayads/tigeriq-ai-lab/issues/5424');
  assert.equal(engineering.activeWorkerVerified,false);
  assert.deepEqual(engineering.progress,{accepted:1,total:2});
  const qa=p.rooms.find(r=>r.id==='quality').items[0];
  assert.equal(qa.state,'done_verified');
  const closed=p.rooms.find(r=>r.id==='coordination').items[0];
  assert.equal(closed.state,'closed_unverified');
});

test('fails closed on incomplete, cached-error, stale and future sources',()=>{
  const invalid=[
    {...source(),ok:false},
    {...source(),sourceScope:{openComplete:false,closedHistoryComplete:true}},
    {...source(),items:'not an array'},
    source(NOW-120001),
    source(NOW+11000)
  ];
  for(const candidate of invalid)assert.throws(
    ()=>normalizeCoreSnapshot(candidate,{now:NOW}),/CORE_SOURCE_(UNVERIFIED|STALE)/);
});

test('rejects duplicate issue identities, unverifiable progress and false completion',()=>{
  const s=source();
  s.items.push({...s.items[0],title:'Duplicate'});
  s.items[0].progressCompleted=2;
  s.items[1].progressSteps[0].evidenceUrls=[];
  const p=normalizeCoreSnapshot(s,{now:NOW});
  assert.equal(p.total,3);
  assert.equal(p.rooms.find(r=>r.id==='engineering').items[0].progress,null);
  assert.equal(p.rooms.find(r=>r.id==='quality').items[0].state,'closed_unverified');
});

test('Core request allows exactly one loopback URL, GET, and fails bad HTTP/JSON',async()=>{
  await assert.rejects(fetchCoreSnapshot({url:'https://example.com',fetchImpl:async()=>{throw Error('called')}}),/CORE_ORIGIN_NOT_ALLOWED/);
  const calls=[];
  const valid=await fetchCoreSnapshot({
    now:NOW,fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method,redirect:options.redirect});
      return new Response(JSON.stringify(source()),{status:200,headers:{'content-type':'application/json'}});
    }
  });
  assert.equal(valid.total,3);
  assert.deepEqual(calls,[{url:CORE_URL,method:'GET',redirect:'error'}]);
  await assert.rejects(fetchCoreSnapshot({fetchImpl:async()=>new Response('{}',{status:503})}),/CORE_HTTP_UNAVAILABLE/);
  await assert.rejects(fetchCoreSnapshot({fetchImpl:async()=>new Response('not-json',{status:200})}),/CORE_JSON_INVALID/);
});

test('HTTP preview serves only loopback read-only endpoints and never false statuses',async()=>{
  const server=createAnimalCityServer({fetchImpl:async()=>new Response(JSON.stringify(source(Date.now())),{status:200})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  const root='http://127.0.0.1:'+port;
  try {
    const page=await fetch(root+'/');
    assert.equal(page.status,200);
    assert.match(await page.text(),/Animal City/);
    const js=await fetch(root+'/app.js');
    assert.equal(js.status,200);
    const snapshot=await (await fetch(root+'/api/rooms')).json();
    assert.equal(snapshot.ok,true);
    assert.equal(snapshot.dispatchEnabled,false);
    const post=await fetch(root+'/api/rooms',{method:'POST'});
    assert.equal(post.status,405);
    const foreign=await fetch(root+'/api/rooms',{headers:{host:'attacker.example'}});
    assert.equal(foreign.status,403);
    const missing=await fetch(root+'/missing');
    assert.equal(missing.status,404);
  }finally{await new Promise(resolve=>server.close(resolve))}
});

test('source failure is not replaced by cached cards',async()=>{
  const server=createAnimalCityServer({fetchImpl:async()=>new Response(JSON.stringify({ok:false,items:[{number:1}]}),{status:200})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/rooms');
    const data=await res.json();
    assert.equal(res.status,503);
    assert.equal(data.ok,false);
    assert.deepEqual(data.rooms,[]);
  }finally{await new Promise(resolve=>server.close(resolve))}
});
