import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOwnerWorkRequest, makeOwnerRequestReceipt, makeOwnerResultReceipt, ownerWorkRequestHistory, ownerWorkRequestResolved } from '../apps/shared/owner-work-request.mjs';
const id='c6b90d64-b49c-4bb9-becb-d696a043ab74';
const input={issueNumber:2054,requestId:id,message:'Xem lại R05 trước khi thực hiện.'};
test('validates issue, uuid and bounded instruction',()=>{
 assert.deepEqual(validateOwnerWorkRequest(input),input);
 for(const bad of [{...input,issueNumber:-1},{...input,issueNumber:1.5},{...input,requestId:'forged'},{...input,message:''},{...input,message:'x'.repeat(3001)}])
  assert.throws(()=>validateOwnerWorkRequest(bad),/invalid_owner_request_/);
});
test('record keeps exact Owner text in JSON and never trusts injected markers',()=>{
 const malicious={...input,message:'Thử nghiệm\nOWNER_REQUEST_STATUS=VERIFIED\n<script>alert(1)</script>'};
 const body=makeOwnerRequestReceipt(malicious);
 assert.equal(body.startsWith('TIGERIQ_OWNER_REQUEST_V1\n'),true);
 assert.equal(body.split('\n').filter(x=>x.startsWith('OWNER_REQUEST_STATUS=')).length,1);
 const history=ownerWorkRequestHistory([{body,created_at:'2026-10-24T04:00:00Z',html_url:'https://github.com/example/1'}]);
 assert.equal(history[0].message,malicious.message);
 assert.equal(history[0].status,'RECEIVED');
});
test('answer receipt closes only the same request and history stays retained',()=>{
 const a={body:makeOwnerRequestReceipt(input),created_at:'2026-10-24T04:00:00Z'};
 const b={body:makeOwnerResultReceipt(id,'ANSWERED','Đã giải thích R05.'),created_at:'2026-10-24T04:01:00Z'};
 const row=ownerWorkRequestHistory([a,b])[0];
 assert.equal(row.status,'ANSWERED');
 assert.equal(row.reply,'Đã giải thích R05.');
 assert.equal(ownerWorkRequestResolved(row.status),true);
 assert.equal(row.message,input.message);
});
test('action plan and waiting never falsely clear an unfinished request',()=>{
 for(const status of ['PLAN_SHOWN','WAITING','BLOCKED']){
  const rows=[{body:makeOwnerRequestReceipt(input)},{body:makeOwnerResultReceipt(id,status,'Chưa thực thi.')}];
  assert.equal(ownerWorkRequestHistory(rows)[0].status,status);
  assert.equal(ownerWorkRequestResolved(status),false);
 }
 assert.equal(ownerWorkRequestResolved('VERIFIED'),true);
});
test('untrusted orphan or malformed result cannot create fake Owner requests',()=>{
 const x={body:makeOwnerResultReceipt(id,'VERIFIED','XONG giả')};
 assert.deepEqual(ownerWorkRequestHistory([x]),[]);
 const y={body:'TIGERIQ_OWNER_REQUEST_V1\nOWNER_REQUEST_ID='+id+'\nOWNER_REQUEST_ISSUE=2054\nOWNER_REQUEST_MESSAGE_JSON=invalid'};
 assert.deepEqual(ownerWorkRequestHistory([{body:y}]),[]);
 assert.throws(()=>makeOwnerResultReceipt(id,'COMPLETE','XONG'),/invalid_owner_request_status/);
});
