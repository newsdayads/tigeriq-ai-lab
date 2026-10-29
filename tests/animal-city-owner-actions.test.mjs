import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnimalCityServer} from '../apps/agents-city-tigeriq/server.mjs';

const objectiveId='OBJ-123e4567-e89b-42d3-a456-426614174000';
const key='11111111-1111-4111-8111-111111111111';
const body={objective:'Phân tích nguyên nhân Core bị kẹt job và xuất biên nhận QA.',routingProfile:'LOCAL',priority:'P2'};
async function boot(fetchImpl){
  const server=createAnimalCityServer({fetchImpl});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root='http://127.0.0.1:'+server.address().port;
  return {server,root,close:()=>new Promise(resolve=>server.close(resolve))};
}
function coreMock(counter){
  return async (url,opts)=>{
    if(url==='http://127.0.0.1:8795/api/objectives'){
      counter.count++;counter.last=JSON.parse(opts.body);
      return new Response(JSON.stringify({ok:true,id:objectiveId,campaign:true,phaseCount:3,currentPhase:0}),{status:201});
    }
    if(url==='http://127.0.0.1:8795/api/status'){
      return new Response(JSON.stringify({
        ok:true,core:{time:new Date().toISOString()},
        objectives:[{id:objectiveId,objective:body.objective,priority:'P2',
          status:'active',summary:'',metadata:{source:'animal-city-local',campaign:{
            currentPhase:0,phases:[{title:'P1'},{title:'P2'},{title:'P3'}],checkpoints:[]}},
          updated_at:new Date().toISOString()}],
        jobs:[{id:'JOB-1',objective_id:objectiveId,status:'running',employee_id:'NV08',
          resource_id:'res:ollama:qwen3-8b:nv08-manager:core',provider:'ollama',capability:'reasoning',
          lease_until:new Date(Date.now()+60000).toISOString(),result:null,failure:null}],
      }),{status:200});
    }
    throw Error('UNEXPECTED_FETCH:'+url);
  };
}
test('local browser action creates one actual Core LOCAL/P2 objective and returns receipt',async()=>{
  const counter={count:0,last:null};const app=await boot(coreMock(counter));
  try{
    const config=await (await fetch(app.root+'/api/owner-config')).json();
    assert.equal(config.mode,'LOCAL_ONLY_P2');
    const headers={'content-type':'application/json','origin':app.root,
      'x-tigeriq-action':config.token,'x-request-id':key};
    const send=()=>fetch(app.root+'/api/owner-objectives',{method:'POST',headers,body:JSON.stringify(body)});
    const first=await send(),data=await first.json();
    assert.equal(first.status,201);
    assert.equal(data.objectiveId,objectiveId);
    assert.equal(data.receiptVerified,true);
    assert.equal(data.routingProfile,'LOCAL');
    assert.equal(counter.count,1);
    assert.equal(counter.last.objective,body.objective);
    assert.equal(counter.last.priority,'P2');
    assert.equal(counter.last.routingProfile,'LOCAL');
    assert.equal(counter.last.source,'animal-city-local');
    assert.equal(counter.last.phases.length,3);
    assert.match(counter.last.phases[0].title,/Thực thi/);
    assert.match(counter.last.phases[1].title,/QA độc lập/);
    assert.match(counter.last.phases[2].title,/Nghiệm thu/);
    const second=await send();
    assert.equal(second.status,201);
    assert.equal(counter.count,1,'idempotency key must never enqueue duplicate Core objective');
    const recent=await (await fetch(app.root+'/api/owner-objectives')).json();
    assert.equal(recent.ok,true);
    assert.equal(recent.objectives[0].jobs[0].employeeId,'NV08');
    assert.equal(recent.objectives[0].jobs[0].status,'running');
    assert.equal(recent.objectives[0].jobs[0].leaseActive,true);
    assert.equal(recent.objectives[0].campaign.phaseCount,3);
    assert.equal(recent.objectives[0].campaign.currentPhase,0);
  }finally{await app.close()}
});
test('invalid origin, missing token, paid AUTO and P0 are rejected before Core',async()=>{
  const counter={count:0};const app=await boot(coreMock(counter));
  try{
    const {token}=await (await fetch(app.root+'/api/owner-config')).json();
    const request=(input,headers={})=>fetch(app.root+'/api/owner-objectives',{
      method:'POST',headers:{'content-type':'application/json','x-request-id':key,
        'origin':app.root,'x-tigeriq-action':token,...headers},body:JSON.stringify(input)});
    assert.equal((await request(body,{'origin':'http://attacker.local'})).status,403);
    assert.equal((await request(body,{'x-tigeriq-action':'invalid'})).status,403);
    assert.equal((await request({...body,routingProfile:'AUTO'})).status,400);
    assert.equal((await request({...body,priority:'P0'})).status,400);
    assert.equal((await request({...body,objective:'short'})).status,400);
    assert.equal((await fetch(app.root+'/api/owner-config',{method:'POST'})).status,405);
    assert.equal(counter.count,0);
  }finally{await app.close()}
});
test('Core outage has fail-closed status; never invents accepted job',async()=>{
  const app=await boot(async()=>new Response('down',{status:503}));
  try{
    const config=await (await fetch(app.root+'/api/owner-config')).json();
    const res=await fetch(app.root+'/api/owner-objectives',{method:'POST',
      headers:{'content-type':'application/json','origin':app.root,
        'x-tigeriq-action':config.token,'x-request-id':key},body:JSON.stringify(body)});
    assert.equal(res.status,502);
    assert.equal((await res.json()).ok,false);
    const recent=await fetch(app.root+'/api/owner-objectives');
    assert.equal(recent.status,503);
    assert.deepEqual((await recent.json()).objectives,[]);
  }finally{await app.close()}
});
