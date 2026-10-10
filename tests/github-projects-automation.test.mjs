import {test} from 'node:test';
import assert from 'node:assert/strict';
import {route,verifyCore,coreStates,proposals,validateInventory,isolateActions} from '../scripts/github-projects-automation.mjs';
const base='https://github.com/newsdayads/';
test('classifies explicit project code, not priority or arbitrary title',()=>{
 assert.equal(route({url:base+'tigeriq-ai-lab/issues/100',title:'[P0][PAPERCLIP] Feature',labels:[]}).project,4);
 assert.equal(route({url:base+'tigeriq-ai-lab/issues/101',title:'[P0][CORE] Fix',labels:[]}).project,2);
 assert.equal(route({url:base+'tigeriq-ai-lab/issues/102',title:'Generic Feature',labels:[]}).project,undefined);
 assert.equal(route({url:base+'tigeriq-ai-lab/issues/103',title:'[TIGERIQ NEWS][DRIVER] conflict',labels:[]}).reason,'CONFLICT');
 assert.equal(route({url:base+'tigeriq-ai-lab/issues/105',title:'Other',labels:['project:DEXCAM PERSONAL']}).project,7);
});
test('repository-exclusive routing excludes sensitive and unknown repositories',()=>{
 assert.equal(route({url:base+'drivetrack/issues/235'}).project,6);
 assert.equal(route({url:base+'derophone/issues/2'}).project,8);
 assert.equal(route({url:base+'drivetrack/issues/366'}).reason,'SENSITIVE_EXCLUDED');
 assert.equal(route({url:base+'other/issues/12'}).reason,'INVALID_URL');
});
const time=Date.parse('2026-10-10T05:00:00Z');
const core=()=>({ok:true,liveConnected:true,mode:'pc01-live',authority:'PC01 live runtime',source:{core:true},generatedAt:new Date(time).toISOString(),workProjection:{mode:'pc01-live+github',stale:false,openIssueEnumerationComplete:true,verifiedAt:new Date(time).toISOString()}});
test('Core requires connected, complete, fresh, attested source',()=>{
 assert.doesNotThrow(()=>verifyCore(core(),time));
 assert.throws(()=>verifyCore({...core(),source:{core:false}},time));
 assert.throws(()=>verifyCore({...core(),workProjection:{...core().workProjection,stale:true}},time));
 assert.throws(()=>verifyCore({...core(),generatedAt:new Date(time-120001).toISOString()},time));
});
test('status mapping: running requires live active row; review can be shown',()=>{
 const url=base+'tigeriq-ai-lab/issues/123';
 const c={openWork:[{url,workKind:'WORK',status:'RA SOAT',projectId:'tigeriq-platform'}],activeWork:[],recentWork:[]};
 assert.deepEqual(coreStates(c).get(url),{state:'RÀ SOÁT',projectId:'tigeriq-platform'});
 c.openWork=[{url,workKind:'WORK',status:'RUNNING',projectId:'tigeriq-platform'}];
 assert.equal(coreStates(c).get(url),undefined);
 c.activeWork=[{url,workKind:'WORK',status:'RUNNING',live:true,projectId:'tigeriq-platform'}];
 assert.deepEqual(coreStates(c).get(url),{state:'ĐANG XỬ LÝ',projectId:'tigeriq-platform'});
});
test('failure in one project does not prevent other project action',()=>{
 const actions=[{number:2,kind:'status'},{number:6,kind:'add'},{number:3,kind:'status'}];
 const executed=[];
 const out=isolateActions(actions,a=>{executed.push(a.number);if(a.number===6)throw Error('SIMULATED_FAILURE');return 1});
 assert.deepEqual(executed,[2,6,3]);assert.equal(out.applied,2);assert.equal(out.failures.length,1);assert.equal(out.failures[0].project,6);
});
test('project inventory refuses public projects and cross-project duplicates',()=>{
 const inventory={user:{}};
 for(let i=1;i<=8;i++){
  const title=['','TIGERIQ — MASTER PORTFOLIO','TIGERIQ AI','TIGERIQ NEWS / MEDIA','PAPERCLIP VNEXT','REVENUE LAB','TIGERIQ DRIVER','DEXCAM PERSONAL','TIGERIQ COIN'][i];
  inventory.user['p'+i]={id:'PVT_'+i,number:i,title,public:false,viewerCanUpdate:true,url:'https://github.com/users/newsdayads/projects/'+i,fields:{nodes:[],pageInfo:{hasNextPage:false}},items:{nodes:[],pageInfo:{hasNextPage:false}}};
 }
 assert.equal(validateInventory(inventory).size,8);
 inventory.user.p4.public=true;assert.throws(()=>validateInventory(inventory));
 inventory.user.p4.public=false;
 inventory.user.p6.viewerCanUpdate=false;assert.throws(()=>validateInventory(inventory));
 inventory.user.p6.viewerCanUpdate=true;
 const dup={id:'I',content:{id:'C',url:base+'tigeriq-ai-lab/issues/10'}};
 inventory.user.p2.items.nodes=[dup];inventory.user.p3.items.nodes=[dup];assert.throws(()=>validateInventory(inventory));
});
test('mapping fail-closed on ambiguous already-mastered Issue',()=>{
 const u=base+'tigeriq-ai-lab/issues/11';
 const ps=new Map();for(let n=1;n<=8;n++)ps.set(n,{items:new Map(),fields:{nodes:[{name:'Status',options:[{name:'RÀ SOÁT',id:'OPT'}]}]}});
 ps.get(1).items.set(u,{fieldValues:{nodes:[]}});
 const x=proposals(ps,[{url:u,title:'[CORE] Fix'}],new Map());
 assert.equal(x.actions.length,0);assert.equal(x.quarantine.length,1);
});

test('Core project ownership drift is quarantined; no cross-project status overwrite',()=>{
 const url=base+'tigeriq-ai-lab/issues/4640';
 const statusField={name:'Status',id:'F_STATUS',options:[{id:'REVIEW',name:'RÀ SOÁT'},{id:'BLOCK',name:'BỊ CHẶN'}]};
 const ps=new Map();
 for(let n=1;n<=8;n++)ps.set(n,{id:'PVT_'+n,number:n,items:new Map(),fields:{nodes:[statusField]}});
 const masterRow={id:'MASTER_ITEM',fieldValues:{nodes:[{name:'TigerIQ AI',field:{name:'PROJECT'}},{name:'BỊ CHẶN',field:{name:'Status'}}]}};
 const aiRow={id:'AI_ITEM',fieldValues:{nodes:[{name:'BỊ CHẶN',field:{name:'Status'}}]}};
 ps.get(1).items.set(url,masterRow);ps.get(2).items.set(url,aiRow);
 const conflicting=coreStates({recentWork:[],activeWork:[],openWork:[{url,workKind:'WORK',status:'RA SOAT',projectId:'tigeriq-news'}]});
 const blocked=proposals(ps,[],conflicting);
 assert.equal(blocked.actions.length,0);
 assert.deepEqual(blocked.quarantine.map(x=>x.reason),['CORE_PROJECT_MISMATCH']);
 const matching=coreStates({recentWork:[],activeWork:[],openWork:[{url,workKind:'WORK',status:'RA SOAT',projectId:'tigeriq-platform'}]});
 const safe=proposals(ps,[],matching);
 assert.equal(safe.actions.length,2);
 assert.deepEqual(safe.actions.map(x=>x.number),[2,1]);
});
