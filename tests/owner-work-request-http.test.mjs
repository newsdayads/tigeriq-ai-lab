import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/control.mjs';

function response(){
 return {statusCode:200,headers:{},body:null,
  setHeader(key,value){this.headers[key.toLowerCase()]=value;},
  end(value){this.body=String(value||'');}};
}
test('unauthenticated owner request GET returns HTTP 401 rather than unhandled 500',async()=>{
 const req={method:'GET',url:'/api/control?operation=owner-work-request&issue=2054',headers:{host:'localhost'}};
 const res=response();
 await handler(req,res);
 assert.equal(res.statusCode,401);
 assert.equal(JSON.parse(res.body).error,'owner_session_required');
});
test('unauthenticated owner request POST returns HTTP 401, never writes',async()=>{
 const json=JSON.stringify({operation:'owner-work-request',issueNumber:2054,requestId:'c6b90d64-b49c-4bb9-becb-d696a043ab74',message:'Xem R05'});
 const req={method:'POST',url:'/api/control',headers:{host:'localhost',origin:'https://localhost'},async *[Symbol.asyncIterator](){yield Buffer.from(json);}};
 const res=response();
 await handler(req,res);
 assert.equal(res.statusCode,401);
 assert.equal(JSON.parse(res.body).error,'owner_session_required');
});
