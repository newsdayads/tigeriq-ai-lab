import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleCoreResources,selectIdleWorkers} from '../scripts/web-control-audit/worker-selection.mjs';
import {getViewportPolicy} from '../scripts/web-control-audit/viewport-policy.mjs';
import {runBrowserAudit} from '../scripts/web-control-audit/browser-audit-adapter.mjs';
import {processRepairHandoff} from '../scripts/web-control-audit/repair-handoff.mjs';
import {runHourlyAuditCycle} from '../scripts/web-control-audit/hourly-runner.mjs';

const okJson=(value)=>({ok:true,json:async()=>value});

test('Core resource selection uses resources truth and fails closed',async()=>{
  const data={resources:[
    {employee_id:'NV10',resource_id:'r10',enabled:true,health_state:'ONLINE',work_state:'BUSY',cost_tier:'LOCAL',rank:90},
    {employee_id:'NV12',resource_id:'r12',enabled:true,health_state:'ONLINE',work_state:'IDLE',cost_tier:'FREE',rank:20},
    {employee_id:'NV11',resource_id:'r11',enabled:true,health_state:'ONLINE',work_state:'IDLE',cost_tier:'FREE',rank:10}
  ]};
  assert.deepEqual(eligibleCoreResources(data).map((x)=>x.employee_id),['NV11','NV12']);
  const selected=await selectIdleWorkers({fetchImpl:async()=>okJson(data)});
  assert.equal(selected[0].employee_id,'NV11');
  await assert.rejects(()=>selectIdleWorkers({fetchImpl:async()=>okJson({resources:[]})}),/NO_IDLE_READY/);
});

test('viewport policy always includes FullHD + mobile + rotating extra',()=>{
  assert.deepEqual(getViewportPolicy(0).viewports.map((x)=>x.label),['FullHD','mobile','4K']);
  assert.equal(getViewportPolicy(1).rotation.label,'2K');
  assert.equal(getViewportPolicy(2).rotation.label,'tablet');
});

test('browser audit applies resize and full audit checks through MCP calls',async()=>{
  const calls=[];
  const fake={
    async callTool({name,arguments:args}){
      calls.push({name,args});
      if(name==='new_page')return {content:[{text:'ok'}]};
      if(name==='list_pages')return {content:[{text:'## Pages\n2: Web Control [selected]'}]};
      if(name==='resize_page')return {content:[{text:'ok'}]};
      if(name==='take_snapshot')return {content:[{text:'RootWebArea TigerIQ'}]};
      if(name==='list_console_messages')return {content:[{text:'## Console messages'}]};
      if(name==='list_network_requests')return {content:[{text:'## Network requests'}]};
      if(name==='evaluate_script'){
        if(args.function.includes('document.title')){
          const last=calls.filter((x)=>x.name==='resize_page').at(-1).args;
          return {content:[{text:'{"title":"TigerIQ","width":'+last.width+',"height":'+last.height+',"bodyLength":100,"overflowX":false}'}]};
        }
        if(args.function.includes("fetch('/api/status'"))return {content:[{text:'{"changed":true,"before":"a","after":"b"}'}]};
        if(args.function.includes('Nhân sự AI'))return {content:[{text:'{"found":true,"clicked":true,"text":"Nhân sự AI"}'}]};
      }
      throw new Error('unexpected '+name);
    }
  };
  const viewports=getViewportPolicy(0).viewports;
  const result=await runBrowserAudit('http://example.test',viewports,{client:fake});
  assert.equal(result.sweepVerified,true);
  assert.deepEqual(calls.filter((x)=>x.name==='resize_page').map((x)=>[x.args.width,x.args.height]),viewports.map((x)=>[x.width,x.height]));
});

test('material failure creates one deduplicated Coding Lane repair handoff',async()=>{
  const workers=[{employee_id:'NV11',resource_id:'r11',provider:'groq',model:'m'}];
  let posts=0;
  const fetchImpl=async(url,init={})=>{
    if(String(url).endsWith('/api/status'))return okJson({objectives:[]});
    if(String(url).endsWith('/api/objectives')&&init.method==='POST'){posts++;return okJson({ok:true,id:'CODEOBJ-test'});}
    throw new Error('unexpected '+url);
  };
  const options={
    selectWorkers:async()=>workers,
    runAudit:async()=>({status:'audit_failed',sweepVerified:false,failures:['network:500'],results:[]}),
    fetchImpl
  };
  const first=await processRepairHandoff('http://failure-unique.test',7,options);
  const second=await processRepairHandoff('http://failure-unique.test',8,options);
  assert.equal(first.repair.queued,true);
  assert.equal(second,null);
  assert.equal(posts,1);
});

test('hourly runner records selected employee/resource',async()=>{
  const worker={employee_id:'NV20',resource_id:'r20',provider:'nvidia',model:'m'};
  const result=await runHourlyAuditCycle(['http://example.test'],{
    selectWorkers:async()=>[worker],
    runAudit:async()=>({status:'audit_complete',sweepVerified:true,failures:[],results:[]}),
    fetchImpl:async()=>okJson({}),
    cycleIndex:2
  });
  assert.equal(result.pass,true);
  assert.equal(result.results[0].handoff.worker.employee_id,'NV20');
  assert.deepEqual(result.results[0].handoff.viewports.map((x)=>x.label),['FullHD','mobile','tablet']);
});
