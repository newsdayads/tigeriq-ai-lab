import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
const start=dashboard.indexOf('function ownerRequestRememberDraft()');
const end=dashboard.indexOf('function ownerRequestRecordView(',start);
assert.ok(start>0&&end>start,'modal draft memory helpers must exist in the shipped dashboard');

// Test the actual browser helpers against a minimal fake modal, not a rewritten algorithm.
const createHarness=new Function(`
 const ownerRequestDraftMemory=new Map();
 const ownerRequestDraft={value:''};
 let ownerRequestIssueNumber=null,ownerRequestLastId=null,ownerRequestLastMessage=null;
 ${dashboard.slice(start,end)}
 return {
   set(issue,text,id=null,submitted=null){
     ownerRequestIssueNumber=issue;ownerRequestDraft.value=text;
     ownerRequestLastId=id;ownerRequestLastMessage=submitted;
   },
   remember:ownerRequestRememberDraft,
   restore(issue){
     ownerRequestIssueNumber=issue;
     ownerRequestRestoreDraft(issue);
     return {text:ownerRequestDraft.value,id:ownerRequestLastId,submitted:ownerRequestLastMessage};
   },
   size:()=>ownerRequestDraftMemory.size,
   has:issue=>ownerRequestDraftMemory.has(issue),
 };
`) as () => {
 set:(issue:number,text:string,id?:string|null,submitted?:string|null)=>void;
 remember:()=>void;
 restore:(issue:number)=>{text:string;id:string|null;submitted:string|null};
 size:()=>number;
 has:(issue:number)=>boolean;
};

test('switching cards preserves unfinished Owner text and the exact retry UUID',()=>{
 const h=createHarness();
 h.set(5252,'Kiểm tra tiếp R11','uuid-A','Kiểm tra tiếp R11');
 h.remember();
 h.set(5253,'Yêu cầu riêng của R10');h.remember();
 assert.deepEqual(h.restore(5252),{text:'Kiểm tra tiếp R11',id:'uuid-A',submitted:'Kiểm tra tiếp R11'});
 assert.deepEqual(h.restore(5253),{text:'Yêu cầu riêng của R10',id:null,submitted:null});
});

test('only blank resolved draft is evicted; unresolved retry identity survives',()=>{
 const h=createHarness();
 h.set(5252,'Làm tiếp','uuid-B','Làm tiếp');h.remember();
 h.set(5252,'',null,null);h.remember();
 assert.equal(h.has(5252),false);
 assert.deepEqual(h.restore(5252),{text:'',id:null,submitted:null});
 h.set(5252,'', 'uuid-pending','Làm tiếp');h.remember();
 assert.equal(h.has(5252),true,'pending receipts are not evicted merely because the visible input became blank');
});

test('per-tab memory is bounded and never written to browser disk storage',()=>{
 const h=createHarness();
 for(let issue=1;issue<=25;issue++){h.set(issue,'Nội dung '+issue);h.remember()}
 assert.equal(h.size(),20);
 assert.equal(h.has(1),false);
 assert.equal(h.has(6),true);
 const snippet=dashboard.slice(start,end);
 assert.ok(!/sessionStorage|localStorage|indexedDB/.test(snippet));
});

test('real card lifecycle snapshots before close/switch and restores on reopen',()=>{
 assert.ok(dashboard.includes("ownerRequestDraft.addEventListener('input',ownerRequestRememberDraft);"));
 assert.ok(dashboard.includes('ownerRequestLastId=requestId;ownerRequestLastMessage=message;ownerRequestRememberDraft();'));
 assert.ok(dashboard.includes('ownerRequestOpen(number){ownerRequestRevision++;ownerRequestSubmitting=false;ownerRequestRememberDraft();'));
 assert.ok(dashboard.includes("ownerRequestDraft.value='';ownerRequestRestoreDraft(number);"));
 assert.ok(dashboard.includes('ownerRequestRememberDraft();ownerRequestRevision++;ownerRequestSubmitting=false;ownerRequestIssueNumber=null;'));
 assert.ok(dashboard.includes("ownerRequestLastMessage=null;ownerRequestRememberDraft()}"),'terminal receipts should clear the old draft snapshot');
 assert.ok(dashboard.includes('ownerRequestCanClearDraft(mine.status,mine.requestId,ownerRequestLastId,ownerRequestLastMessage,ownerRequestDraft.value)'),'late terminal results must match their originating request');
});
