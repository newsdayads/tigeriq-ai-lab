import test from 'node:test';
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
  assert.deepEqual(res.body.coverage,{issues:100,complete:false,truncated:true,pagesLimit:12,pagesFetched:1,stopReason:'GITHUB_HTTP_422_PAGE_2'});
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
  assert.deepEqual(res.body.coverage,{issues:1,complete:true,truncated:false,pagesLimit:12,pagesFetched:1,stopReason:null});
});

test('invalid GitHub schema fails closed',async()=>{
  const {res}=await invoke(()=>response(200,{message:'not an array'}));
  assert.equal(res.statusCode,503);
  assert.equal(res.body.reason,'GITHUB_SCHEMA');
});
