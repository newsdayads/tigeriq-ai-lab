import test from 'node:test';
import assert from 'node:assert/strict';

import {selectIdleWorker,selectIdleWorkers} from '../scripts/web-control-audit/worker-selection.mjs';
import {getViewportPolicy} from '../scripts/web-control-audit/viewport-policy.mjs';
import {runBrowserAudit} from '../scripts/web-control-audit/browser-audit-adapter.mjs';
import {failureIdentity,processRepairHandoff} from '../scripts/web-control-audit/repair-handoff.mjs';
import {cycleIndexForTime,runHourlyAuditCycle} from '../scripts/web-control-audit/hourly-runner.mjs';

const okJson=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
const toolJson=(value)=>({content:[{text:`Script ran on page and returned:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``}]});

test('Core resource selection uses live resources truth and fails closed',async()=>{
  const resources=[
    {employee_id:'NV10',resource_id:'r10',enabled:true,health_state:'ONLINE',work_state:'BUSY',cost_tier:'LOCAL',rank:1,capabilities:['general']},
    {employee_id:'NV12',resource_id:'r12',enabled:true,health_state:'ONLINE',work_state:'IDLE',cost_tier:'FREE',rank:20,quota_state:{usable:true},capabilities:['review']},
    {employee_id:'NV11',resource_id:'r11',enabled:true,health_state:'ONLINE',work_state:'IDLE',cost_tier:'FREE',rank:10,quota_state:{usable:true},capabilities:['general']},
    {employee_id:'NV13',resource_id:'r13',enabled:true,health_state:'RATE_LIMITED',work_state:'RATE_LIMITED',cost_tier:'FREE',rank:5,capabilities:['general']}
  ];
  const fetchImpl=async()=>okJson({resources});
  const selected=await selectIdleWorker({fetchImpl});
  assert.equal(selected.employee_id,'NV11');
  assert.deepEqual((await selectIdleWorkers({fetchImpl})).map(row=>row.employee_id),['NV11','NV12']);
  await assert.rejects(
    ()=>selectIdleWorker({fetchImpl:async()=>okJson({resources:resources.map(row=>({...row,work_state:'BUSY'}))})}),
    /NO_IDLE_READY_ZERO_COST_AUDIT_RESOURCE/
  );
});

test('viewport policy always runs FullHD + mobile and rotates 4K/2K/tablet',()=>{
  assert.deepEqual(getViewportPolicy(0).viewports.map(v=>v.label),['FullHD','mobile','4K']);
  assert.deepEqual(getViewportPolicy(1).viewports.map(v=>v.label),['FullHD','mobile','2K']);
  assert.deepEqual(getViewportPolicy(2).viewports.map(v=>v.label),['FullHD','mobile','tablet']);
});

test('browser audit applies each real MCP viewport and full audit contract',async()=>{
  const calls=[];
  let active={width:0,height:0};
  const fake={
    async callTool({name,arguments:args}){
      calls.push({name,args});
      if(name==='new_page'||name==='list_pages')return {content:[{text:'## Pages\n2: TigerIQ Web Control [selected]'}]};
      if(name==='resize_page'){active={width:args.width,height:args.height};return {content:[{text:'resized'}]};}
      if(name==='emulate'){
        const match=String(args.viewport||'').match(/^(\d+)x(\d+)x/);
        if(match)active={width:Number(match[1]),height:Number(match[2])};
        return {content:[{text:'Emulation configured successfully'}]};
      }
      if(name==='take_snapshot')return {content:[{text:'RootWebArea TigerIQ Tổng quan Nhân sự AI'}]};
      if(name==='evaluate_script'&&args.function.includes('bodyLength')){
        return toolJson({title:'TigerIQ',readyState:'complete',width:active.width,height:active.height,bodyLength:100,overflowX:false,scrollWidth:active.width});
      }
      if(name==='evaluate_script'&&args.function.includes("fetch('/api/status'"))return toolJson({changed:true,firstTime:'a',secondTime:'b'});
      if(name==='evaluate_script'&&args.function.includes('Nhân sự AI'))return toolJson({found:true,clicked:true,text:'Nhân sự AI',before:'http://test/',after:'http://test/'});
      if(name==='list_console_messages')return {content:[{text:'## Console messages'}]};
      if(name==='list_network_requests')return {content:[{text:'[200] GET http://test/api/status'}]};
      throw new Error('unexpected tool '+name);
    },
    close:async()=>{}
  };
  const policy=getViewportPolicy(2);
  const result=await runBrowserAudit('http://test/',policy.viewports,{client:fake});
  assert.equal(result.sweepVerified,true);
  assert.equal(result.safeInteraction.clicked,true);
  assert.deepEqual(
    calls.filter(call=>call.name==='resize_page').map(call=>[call.args.width,call.args.height]),
    [[1920,1080],[390,844],[1024,768]]
  );
  assert.deepEqual(
    calls.filter(call=>call.name==='emulate').map(call=>call.args.viewport),
    ['1920x1080x1','390x844x1,mobile,touch','1024x768x1']
  );
  assert.equal(calls.filter(call=>call.name==='take_snapshot').length,3);
});

test('failure identity is stable across cycles and encodes viewport',()=>{
  const audit={failures:[{code:'MATERIAL_NETWORK_ERROR',viewport:'FullHD'}]};
  assert.equal(failureIdentity('http://test/',audit),failureIdentity('http://test/',audit));
  assert.notEqual(
    failureIdentity('http://test/',audit),
    failureIdentity('http://test/',{failures:[{code:'MATERIAL_NETWORK_ERROR',viewport:'mobile'}]})
  );
});

test('material failure posts exactly one repair objective and requires a different implementer',async()=>{
  let posts=0;
  let objective='';
  const workers=[{employee_id:'NV11',resource_id:'r11',provider:'groq',model:'m'}];
  const fetchImpl=async(url,init={})=>{
    if(String(url).endsWith('/api/status'))return okJson({objectives:[]});
    if(String(url).endsWith('/api/objectives')&&init.method==='POST'){
      posts++;
      objective=JSON.parse(init.body).objective;
      return okJson({ok:true,id:'CODEOBJ-658-CANARY'},201);
    }
    throw new Error('unexpected '+url);
  };
  const options={
    selectWorkers:async()=>workers,
    runAudit:async()=>({status:'audit_failed',pass:false,sweepVerified:false,failures:[{code:'MATERIAL_NETWORK_ERROR',viewport:'FullHD'}],results:[]}),
    fetchImpl
  };
  const first=await processRepairHandoff('http://failure-658-test/',7,options);
  const second=await processRepairHandoff('http://failure-658-test/',8,options);
  assert.equal(first.status,'REPAIR_ENQUEUED');
  assert.equal(second.status,'REPAIR_DEDUPED');
  assert.equal(posts,1);
  assert.match(objective,/AUDITOR_EMPLOYEE=NV11/);
  assert.match(objective,/IMPLEMENTER_MUST_NOT_EQUAL=NV11/);
  assert.match(objective,/WEB_AUDIT_DEDUP_KEY=/);
});

test('passing audit creates no repair objective',async()=>{
  let posts=0;
  const result=await processRepairHandoff('http://pass-658-test/',1,{
    selectWorkers:async()=>[{employee_id:'NV12',resource_id:'r12',provider:'gemini',model:'m'}],
    runAudit:async()=>({status:'audit_complete',pass:true,sweepVerified:true,failures:[],results:[]}),
    fetchImpl:async()=>{posts++;return okJson({})}
  });
  assert.equal(result.status,'PASS');
  assert.equal(posts,0);
});

test('hourly runner derives a new rotation index each hour and records auditor identity',async()=>{
  assert.equal(cycleIndexForTime(0),0);
  assert.equal(cycleIndexForTime(60*60*1000),1);
  const worker={employee_id:'NV20',resource_id:'r20',provider:'nvidia',model:'m'};
  const result=await runHourlyAuditCycle(['http://example.test'],{
    now:2*60*60*1000,
    selectWorkers:async()=>[worker],
    runAudit:async()=>({status:'audit_complete',pass:true,sweepVerified:true,failures:[],results:[]}),
    fetchImpl:async()=>okJson({})
  });
  assert.equal(result.pass,true);
  assert.equal(result.cycleIndex,2);
  assert.equal(result.results[0].handoff.worker.employee_id,'NV20');
  assert.deepEqual(result.results[0].handoff.viewports.map(v=>v.label),['FullHD','mobile','tablet']);
});
