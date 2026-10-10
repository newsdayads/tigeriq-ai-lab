import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Import the isolated Vercel ESM handler without relying on the repo package type.
const source=readFileSync(new URL('./portfolio.js',import.meta.url),'utf8');
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const fakeIssue=n=>({number:n,title:'Issue '+n,body:'PROJECT_ID=tigeriq-ai',state:'open',labels:[],updated_at:'2026-10-10T00:00:00Z'});
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
const fakeRes=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}});
async function invoke(githubPage,query={}){
  const prior=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes('api.github.com'))return githubPage(Number(new URL(String(url)).searchParams.get('page')));
    return response(200,{ok:true,mode:'public',liveConnected:false,staleAll:true,activeWork:[],openWork:[],recentWork:[]});
  };
  const res=fakeRes();
  try{await handler({method:'GET',query},res);return {res,calls}}finally{globalThis.fetch=prior}
}

test('422 on later GitHub page serves verified partial rows with explicit truncation',async()=>{
  const {res,calls}=await invoke(page=>page===1?response(200,Array.from({length:100},(_,i)=>fakeIssue(i+1))):response(422,{message:'pagination rejected'}));
  assert.equal(res.statusCode,200);
  assert.equal(res.body.ok,true);
  assert.equal(res.body.issues.length,100);
  assert.equal(res.body.coverage.issues,100);assert.equal(res.body.coverage.complete,false);assert.equal(res.body.coverage.stopReason,'GITHUB_HTTP_422_PAGE_2');assert.equal(res.body.coverage.nextSince,null);
  assert.equal(res.body.core.connected,true);
  assert.equal(calls.filter(x=>x.includes('api.github.com')).length,2);
});

test('422 on first GitHub page fails closed with page-specific evidence',async()=>{
  const {res}=await invoke(()=>response(422,{message:'invalid request'}));
  assert.equal(res.statusCode,503);
  assert.equal(res.body.ok,false);
  assert.equal(res.body.reason,'GITHUB_HTTP_422_PAGE_1');
});

test('short first page marks catalog complete and never fabricates more rows',async()=>{
  const {res}=await invoke(()=>response(200,[fakeIssue(12),{...fakeIssue(13),pull_request:{url:'pr'}}]));
  assert.equal(res.statusCode,200);
  assert.equal(res.body.issues.length,1);
  assert.equal(res.body.coverage.issues,1);assert.equal(res.body.coverage.complete,true);assert.equal(res.body.coverage.nextSince,null);assert.equal(res.body.coverage.pagesFetched,1);
});

test('invalid GitHub schema fails closed',async()=>{
  const {res}=await invoke(()=>response(200,{message:'not an array'}));
  assert.equal(res.statusCode,503);
  assert.equal(res.body.reason,'GITHUB_SCHEMA_PAGE_1');
});

test('not_planned closure retains provenance and is not silently promoted to DONE',async()=>{
  const closed={...fakeIssue(88),state:'closed',state_reason:'not_planned',closed_at:'2026-10-10T00:00:00Z'};
  const {res}=await invoke(()=>response(200,[closed]));
  assert.equal(res.statusCode,200);
  assert.equal(res.body.issues[0].state,'closed');
  assert.equal(res.body.issues[0].state_reason,'not_planned');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/state:it\.state==='closed'\?'closed'/);
  assert.doesNotMatch(html,/state:it\.state==='closed'\?'done'/);
  assert.match(html,/data-jobfilter="closed"/);
  assert.match(html,/closed:'ĐÃ ĐÓNG TRÊN GITHUB'/);
  assert.match(html,/githubStateReason:it\.state_reason\|\|null/);
});

test('eight bounded pages return an advancing cursor without attempting GitHub page 9+',async()=>{
 const {res,calls}=await invoke(page=>response(200,Array.from({length:100},(_,i)=>({...fakeIssue(page*100+i),updated_at:new Date(Date.UTC(2025,0,1)+(page*100+i)*1000).toISOString()}))));
 assert.equal(res.statusCode,200);
 assert.equal(res.body.coverage.pagesFetched,8);
 assert.equal(res.body.coverage.complete,false);
 assert.equal(res.body.coverage.stopReason,'NEXT_WINDOW_AVAILABLE');
 assert.match(res.body.coverage.nextSince,/^2025-01-01T/);
 assert.equal(calls.filter(x=>x.includes('api.github.com')).length,8);
 const firstUrl=new URL(calls[0]);
 assert.equal(firstUrl.searchParams.get('direction'),'asc');
 assert.equal(firstUrl.searchParams.get('since'),'2000-01-01T00:00:00Z');
});
test('bad external cursors fail closed without a GitHub request',async()=>{
 const res=fakeRes();
 await handler({method:'GET',query:{since:'2020-01-01T00:00:00Z&page=20'}},res);
 assert.equal(res.statusCode,400);assert.equal(res.body.reason,'INVALID_SINCE_CURSOR');
});
test('non-advancing cursor cannot create an endless history loop',async()=>{
 const {res}=await invoke(()=>response(200,Array.from({length:100},(_,i)=>({...fakeIssue(i),updated_at:'2000-01-01T00:00:00Z'}))));
 assert.equal(res.statusCode,200);
 assert.equal(res.body.coverage.complete,false);
 assert.equal(res.body.coverage.nextSince,null);
 assert.equal(res.body.coverage.stopReason,'CURSOR_NO_PROGRESS');
});

test('later-page transport timeout keeps verified rows without declaring complete',async()=>{
 const {res}=await invoke(page=>{
   if(page===1)return response(200,Array.from({length:100},(_,i)=>fakeIssue(i+1)));
   throw Error('network timeout');
 });
 assert.equal(res.statusCode,200);
 assert.equal(res.body.issues.length,100);
 assert.equal(res.body.coverage.complete,false);
 assert.equal(res.body.coverage.truncated,true);
 assert.equal(res.body.coverage.nextSince,null);
 assert.equal(res.body.coverage.stopReason,'GITHUB_FETCH_ERROR_PAGE_2');
});
test('later-page malformed JSON keeps earlier verified rows with explicit evidence',async()=>{
 const {res}=await invoke(page=>page===1
   ?response(200,Array.from({length:100},(_,i)=>fakeIssue(i+1)))
   :response(200,{error:'unexpected schema'}));
 assert.equal(res.statusCode,200);
 assert.equal(res.body.issues.length,100);
 assert.equal(res.body.coverage.complete,false);
 assert.equal(res.body.coverage.stopReason,'GITHUB_SCHEMA_PAGE_2');
});
test('first-page transport timeout returns 503, not an empty success',async()=>{
 const {res}=await invoke(()=>{throw Error('network timeout')});
 assert.equal(res.statusCode,503);
 assert.equal(res.body.ok,false);
 assert.equal(res.body.reason,'GITHUB_FETCH_ERROR_PAGE_1');
});


test('coverage declares source repository and excludes unindexed external repositories',async()=>{
 const {res}=await invoke(()=>response(200,[fakeIssue(4625)]));
 assert.equal(res.statusCode,200);
 assert.equal(res.body.coverage.scopeRepo,'newsdayads/tigeriq-ai-lab');
 assert.equal(res.body.coverage.externalRepoCoverage,false);
});


test('live-style cursor boundary replays one issue and preserves lossless unique history',async()=>{
 const start=Date.parse('2026-02-01T00:00:00Z');
 const withDate=(num,offset)=>({...fakeIssue(num),updated_at:new Date(start+offset*1000).toISOString()});
 const first=await invoke(page=>response(200,Array.from({length:100},(_,i)=>withDate(page*100+i,page*100+i))));
 assert.equal(first.res.statusCode,200);
 assert.equal(first.res.body.coverage.stopReason,'NEXT_WINDOW_AVAILABLE');
 const boundary=first.res.body.issues.at(-1);
 assert.equal(boundary.number,899);
 const since=first.res.body.coverage.nextSince;
 assert.equal(since,new Date(Date.parse(boundary.updated_at)-1000).toISOString());
 const second=await invoke(page=>response(200,page===1?[boundary,withDate(900,900),withDate(901,901)]:[]),{since});
 assert.equal(second.res.statusCode,200);
 assert.equal(second.res.body.coverage.complete,true);
 assert.equal(second.res.body.coverage.since,since);
 const githubUrl=second.calls.find(x=>x.includes('api.github.com'));
 assert.equal(new URL(githubUrl).searchParams.get('since'),since);
 const combined=new Map([...first.res.body.issues,...second.res.body.issues].map(i=>[i.number,i]));
 assert.equal(combined.size,802);
 assert.equal(combined.get(899).updated_at,boundary.updated_at);
 assert.ok(combined.has(900)&&combined.has(901));
});


test('canonical issue fields survive a long source body while displayed body stays bounded',async()=>{
 const suffix=['PROJECT_ID=dexcam-personal','CURRENT_STATE=BLOCKED_REAL_DEVICE',
               'TARGET_EMPLOYEE=NV02','NEXT_ACTION=Review hardware acceptance',
               'TARGET_PR=4637'].join('\n');
 const longIssue={...fakeIssue(4625),title:'[P1] Generic Android issue',
   body:'Provenance and old updates\n'+'x'.repeat(1700)+'\n'+suffix};
 const {res}=await invoke(()=>response(200,[longIssue]));
 assert.equal(res.statusCode,200);
 const row=res.body.issues[0];
 assert.equal(row.body.length,1500);
 assert.ok(!row.body.includes('PROJECT_ID='));
 assert.equal(row.project_id,'dexcam-personal');
 assert.equal(row.current_state,'BLOCKED_REAL_DEVICE');
 assert.equal(row.worker,'NV02');
 assert.equal(row.next_action,'Review hardware acceptance');
 assert.equal(row.target_pr,'4637');
});

test('metadata extraction never promotes incidental prose to canonical project fields',async()=>{
 const source={...fakeIssue(4457),title:'[P1][CORE vNext] Manager',
   body:'Notes: DeXCam Personal is independent\nAPP_CHROME_MUTATION=FORBIDDEN\n'+
       'The workflow lab requires separate approval'};
 const {res}=await invoke(()=>response(200,[source]));
 assert.equal(res.statusCode,200);
 assert.equal(res.body.issues[0].project_id,null);
 assert.equal(res.body.issues[0].current_state,null);
});

test('current NEXT_ACTION and ASSIGNEE precede stale historical aliases irrespective of key name',async()=>{
 const body=[
   '## CURRENT OVERRIDE — 2026-10-10',
   'PROJECT_ID=dexcam-personal',
   'ASSIGNEE=NV02',
   'NEXT_ACTION=Review physical DeX camera measurements',
   'CURRENT_STATE=SPEC_DOCUMENTATION_REVIEW_PENDING',
   '---',
   '## HISTORICAL — 2026-10-08',
   'NEXT=Old action: start unauthorized APK build',
   'TARGET_EMPLOYEE=NV04',
   'CURRENT_STATE=OLD_UNVERIFIED',
 ].join('\n');
 const {res}=await invoke(()=>response(200,[{...fakeIssue(4625),body}]));
 assert.equal(res.statusCode,200);
 assert.equal(res.body.issues[0].project_id,'dexcam-personal');
 assert.equal(res.body.issues[0].worker,'NV02');
 assert.equal(res.body.issues[0].next_action,'Review physical DeX camera measurements');
 assert.equal(res.body.issues[0].current_state,'SPEC_DOCUMENTATION_REVIEW_PENDING');
});

test('current NEXT and TARGET_EMPLOYEE remain supported without new aliases',async()=>{
 const body='NEXT=Resume verified review\nTARGET_EMPLOYEE=NV03\nASSIGNEE=NV02';
 const {res}=await invoke(()=>response(200,[{...fakeIssue(4457),body}]));
 assert.equal(res.statusCode,200);
 assert.equal(res.body.issues[0].next_action,'Resume verified review');
 assert.equal(res.body.issues[0].worker,'NV03');
});
