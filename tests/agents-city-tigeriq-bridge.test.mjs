import test from 'node:test';
import {request as nodeRequest} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {normalizeCoreSnapshot, fetchCoreSnapshot, CORE_URL} from '../apps/agents-city-tigeriq/core-readonly.mjs';
import {normalizeLiveCoreSnapshot, fetchLiveCoreSnapshot, CORE_STATUS_URL} from '../apps/agents-city-tigeriq/core-live-readonly.mjs';
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

function liveSource(now = NOW) {
  const gemini='res:gemini:gemini-3.5-flash-lite:default:core';
  const ollama='res:ollama:gemma3-4b:default:core';
  return {
    ok:true,
    core:{time:new Date(now).toISOString()},
    resources:[
      {employee_id:'NV12',resource_id:gemini,current_job_id:'JOB-1',status:'BUSY',
        name:'Gemini',provider:'gemini',model:'gemini-3.5-flash-lite'},
      {employee_id:'NV10',resource_id:ollama,current_job_id:'JOB-2',status:'BUSY',
        name:'API Doctor',provider:'ollama',model:'gemma3:4b'},
      {employee_id:'NV11',resource_id:'res:groq:test',current_job_id:'JOB-DONE',status:'BUSY',
        name:'Groq',provider:'groq',model:'test'}
    ],
    jobs:[
      {id:'JOB-1',status:'running',employee_id:'NV12',resource_id:gemini,
        title:'Coordinate Work Order',capability:'reasoning',kind:'compiled_ai',
        provider:'gemini',started_at:new Date(now-5000).toISOString()},
      {id:'JOB-2',status:'running',employee_id:'NV10',resource_id:ollama,
        title:'Independent review',capability:'review',kind:'compiled_ai',
        provider:'ollama',started_at:new Date(now-3000).toISOString(),
        lease_until:new Date(now+90000).toISOString()},
      {id:'JOB-DONE',status:'done',employee_id:'NV11',resource_id:'res:groq:test',
        title:'Old job',capability:'general',kind:'compiled_ai',provider:'groq'}
    ],
    sharedLeases:[
      {work_id:'JOB-1',resource_id:gemini,employee_id:'NV12',
        role:'implementer',lane:'core',lease_until:new Date(now+60000).toISOString()}
    ]
  };
}

function fetchBoth({now = Date.now(), invalidWork = false, invalidLive = false} = {}) {
  return async (url) => {
    if (url === CORE_URL) {
      return new Response(JSON.stringify(invalidWork ? {ok:false,items:[]} : source(now)),
        {status:200,headers:{'content-type':'application/json'}});
    }
    if (url === CORE_STATUS_URL) {
      return new Response(JSON.stringify(invalidLive ? {ok:false} : liveSource(now)),
        {status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error('UNEXPECTED_URL');
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

test('fails closed on incomplete, cached-error, stale and future work-order sources',()=>{
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

test('Core work-order request allows exactly one loopback URL, GET, and fails bad HTTP/JSON',async()=>{
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

test('work-order source retries one transient HTTP failure without using cached data',async()=>{
  let calls=0;
  const valid=await fetchCoreSnapshot({
    now:NOW,retryDelayMs:0,
    fetchImpl:async()=>{
      calls+=1;
      if(calls===1)return new Response('{}',{status:503});
      return new Response(JSON.stringify(source()),{status:200});
    }
  });
  assert.equal(calls,2);
  assert.equal(valid.total,3);
  assert.equal(valid.source,'TigerIQ Core /api/work-orders');
});

test('work-order source keeps retry bounded and fails closed after repeated transport failure',async()=>{
  let calls=0;
  await assert.rejects(fetchCoreSnapshot({
    attempts:2,retryDelayMs:0,
    fetchImpl:async()=>{calls+=1;throw new Error('transient');}
  }),/CORE_HTTP_UNAVAILABLE/);
  assert.equal(calls,2);
});

test('live projection shows only BUSY resources with an exact running job identity',()=>{
  const live=normalizeLiveCoreSnapshot(liveSource(),{now:NOW});
  assert.equal(live.ok,true);
  assert.equal(live.liveWorkerBindingsVerified,true);
  assert.equal(live.totalActiveWorkers,2);
  const nv12=live.workers.find(x=>x.employeeId==='NV12');
  assert.equal(nv12.currentJobId,'JOB-1');
  assert.equal(nv12.activeWorkerVerified,true);
  assert.equal(nv12.leaseVerified,true);
  assert.equal(nv12.leaseSource,'shared');
  assert.equal(nv12.leaseRole,'implementer');
  assert.equal(nv12.room,'coordination');
  const nv10=live.workers.find(x=>x.employeeId==='NV10');
  assert.equal(nv10.leaseVerified,true);
  assert.equal(nv10.leaseSource,'job');
  assert.equal(nv10.leaseRole,'core-job');
  assert.equal(nv10.room,'quality');
  assert.equal(live.workers.some(x=>x.employeeId==='NV11'),false);
});

test('live projection fails closed on stale data and rejects arbitrary origins',async()=>{
  assert.throws(()=>normalizeLiveCoreSnapshot(liveSource(NOW-30001),{now:NOW}),/CORE_LIVE_STALE/);
  assert.throws(()=>normalizeLiveCoreSnapshot({...liveSource(),resources:'bad'},{now:NOW}),/CORE_LIVE_UNVERIFIED/);
  await assert.rejects(fetchLiveCoreSnapshot({
    url:'https://example.com/status',fetchImpl:async()=>{throw Error('called')}
  }),/CORE_LIVE_ORIGIN_NOT_ALLOWED/);
  const calls=[];
  const valid=await fetchLiveCoreSnapshot({
    now:NOW,fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method,redirect:options.redirect});
      return new Response(JSON.stringify(liveSource()),{status:200});
    }
  });
  assert.equal(valid.totalActiveWorkers,2);
  assert.deepEqual(calls,[{url:CORE_STATUS_URL,method:'GET',redirect:'error'}]);
});

test('HTTP operational server exposes work orders, live workers, liveness and readiness only on loopback',async()=>{
  const server=createAnimalCityServer({fetchImpl:fetchBoth({now:Date.now()})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  const root='http://127.0.0.1:'+port;
  try {
    const page=await fetch(root+'/');
    assert.equal(page.status,200);
    assert.match(await page.text(),/Animal City/);
    const js=await fetch(root+'/app.js');
    assert.equal(js.status,200);
    const world=await fetch(root+'/scene3d.js');
    assert.equal(world.status,200);
    assert.match(world.headers.get('content-type'),/javascript/);
    const worldSource=await world.text();
    assert.match(worldSource,/getContext\('webgl'/);
    assert.match(worldSource,/tigeriq:live/);
    assert.match(worldSource,/activeWorkerVerified===true/);
    const worldPost=await fetch(root+'/scene3d.js',{method:'POST'});
    assert.equal(worldPost.status,405);
    const snapshot=await (await fetch(root+'/api/rooms')).json();
    assert.equal(snapshot.ok,true);
    assert.equal(snapshot.dispatchEnabled,false);
    const live=await (await fetch(root+'/api/live')).json();
    assert.equal(live.ok,true);
    assert.equal(live.totalActiveWorkers,2);
    const health=await (await fetch(root+'/health')).json();
    assert.equal(health.ok,true);
    assert.equal(health.mode,'OPERATIONAL_LOCAL');
    assert.equal(health.loopbackOnly,true);
    const readyResponse=await fetch(root+'/ready');
    assert.equal(readyResponse.status,200);
    const ready=await readyResponse.json();
    assert.equal(ready.ok,true);
    assert.equal(ready.workOrders.total,3);
    assert.equal(ready.live.totalActiveWorkers,2);
    const post=await fetch(root+'/api/rooms',{method:'POST'});
    assert.equal(post.status,405);
    const foreignStatus=await new Promise((resolve,reject)=>{
      const req=nodeRequest({hostname:'127.0.0.1',port,path:'/api/rooms',method:'GET',
        headers:{Host:'attacker.example'}},res=>{
        res.resume();res.on('end',()=>resolve(res.statusCode));
      });
      req.on('error',reject);req.end();
    });
    assert.equal(foreignStatus,403);
    const missing=await fetch(root+'/missing');
    assert.equal(missing.status,404);
  }finally{await new Promise(resolve=>server.close(resolve))}
});

test('readiness fails closed if either canonical source is unverified',async()=>{
  const server=createAnimalCityServer({fetchImpl:fetchBoth({now:Date.now(),invalidLive:true})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const ready=await fetch('http://127.0.0.1:'+server.address().port+'/ready');
    assert.equal(ready.status,503);
    assert.equal((await ready.json()).ok,false);
    const work=await fetch('http://127.0.0.1:'+server.address().port+'/api/rooms');
    assert.equal(work.status,200);
    const live=await fetch('http://127.0.0.1:'+server.address().port+'/api/live');
    assert.equal(live.status,503);
    assert.deepEqual((await live.json()).workers,[]);
  }finally{await new Promise(resolve=>server.close(resolve))}
});

test('source failure is not replaced by cached cards',async()=>{
  const server=createAnimalCityServer({fetchImpl:fetchBoth({now:Date.now(),invalidWork:true})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/rooms');
    const data=await res.json();
    assert.equal(res.status,503);
    assert.equal(data.ok,false);
    assert.deepEqual(data.rooms,[]);
  }finally{await new Promise(resolve=>server.close(resolve))}
});

test('PC01 operational task targets the interactive desktop user and remains limited/reversible',async()=>{
  const script=await readFile(new URL('../apps/agents-city-tigeriq/pc01-operational.ps1',import.meta.url),'utf8');
  assert.match(script,/TigerIQ-Animal-City/);
  assert.match(script,/Get-InteractiveUser/);
  assert.match(script,/Get-Process explorer -IncludeUserName/);
  assert.match(script,/RunLevel Limited/);
  assert.match(script,/LogonType Interactive/);
  assert.match(script,/Invoke-RestMethod -Uri \$Url -TimeoutSec 12/);
  assert.match(script,/New-ScheduledTaskAction -Execute \$NodePath/);
  assert.match(script,/127\.0\.0\.1/);
  assert.match(script,/uninstall/);
  assert.doesNotMatch(script,/WindowsIdentity.*GetCurrent/);
  assert.doesNotMatch(script,/RunLevel Highest/);
  assert.doesNotMatch(script,/ExecutionPolicy\s+Bypass/i);
});

test('3D Animal scene is local and cannot fabricate a running AI',async()=>{
  const html=await readFile(new URL('../apps/agents-city-tigeriq/index.html',import.meta.url),'utf8');
  const world=await readFile(new URL('../apps/agents-city-tigeriq/scene3d.js',import.meta.url),'utf8');
  assert.match(html,/scene3d.js/);
  assert.match(html,/animal-scene/);
  assert.match(world,/getContext\('webgl'/);
  assert.match(world,/tigeriq:live/);
  assert.match(world,/liveWorkerBindingsVerified===true/);
  assert.match(world,/activeWorkerVerified===true/);
  assert.doesNotMatch(world,/https?:\/\//);
  assert.doesNotMatch(world,/fetch\(/);
});


test('Core live status projects job lease for Animal City verification',async()=>{
  const core=await readFile(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const statusJobsQuery=core.split('\n').find(line=>
    line.includes('from tigeriq_jobs order by created_at desc limit 40')) || '';
  assert.match(statusJobsQuery,/started_at,lease_until,completed_at/);
});
