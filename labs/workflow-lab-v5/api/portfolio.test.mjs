import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Import the isolated Vercel ESM handler without relying on the repo package type.
const source=readFileSync(new URL('./portfolio.js',import.meta.url),'utf8');
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const fakeIssue=n=>({number:n,title:'Issue '+n,body:'PROJECT_ID=tigeriq-ai',state:'open',labels:[],updated_at:'2026-10-10T00:00:00Z'});
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
const fakeRes=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}});
async function invoke(githubPage){
  const prior=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes('api.github.com'))return githubPage(Number(new URL(String(url)).searchParams.get('page')));
    return response(200,{ok:true,mode:'public',liveConnected:false,staleAll:true,activeWork:[],openWork:[],recentWork:[]});
  };
  const res=fakeRes();
  try{await handler({method:'GET'},res);return {res,calls}}finally{globalThis.fetch=prior}
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
