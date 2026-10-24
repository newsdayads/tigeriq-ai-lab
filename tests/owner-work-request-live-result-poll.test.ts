import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
const begin=dashboard.indexOf('let ownerRequestPollTimer=');
const end=dashboard.indexOf('// Ephemeral per-card drafts',begin);
assert.ok(begin>0&&end>begin,'Owner receipt poller must be extracted from actual shipped dashboard');
const source=dashboard.slice(begin,end);

function harness(){
 let active: (()=>Promise<void>)|null=null,cleared=0,refreshed=0;
 const intervals: number[]=[];
 const create=new Function('setInterval','clearInterval','document',`
 let ownerRequestIssueNumber=5252,ownerRequestRevision=5,ownerRequestLastId='pending-uuid',ownerRequestSubmitting=false;
 async function ownerRequestRefresh(){return globalThis.__fakeOwnerRefresh__()}
 ${source}
 return {
   canPoll:(number,revision,visible)=>ownerRequestShouldPoll(number,revision,visible),
   start:()=>ownerRequestStartPolling(5252),
   stop:()=>ownerRequestStopPolling(),
   setIssue:(value)=>{ownerRequestIssueNumber=value},
   setRevision:(value)=>{ownerRequestRevision=value},
   setRequestId:(value)=>{ownerRequestLastId=value},
   setSubmitting:(value)=>{ownerRequestSubmitting=value},
   setAuthBlocked:(value)=>{ownerRequestPollBlocked=value},
 };
 `)( (fn:()=>Promise<void>,ms:number)=>{active=fn;intervals.push(ms);return 77;},
   (_id:number)=>{active=null;cleared++},
   {get hidden(){return false}}) as {
    canPoll:(number:number,revision:number,visible:boolean)=>boolean;
    start:()=>void;stop:()=>void;
    setIssue:(value:number)=>void;setRevision:(value:number)=>void;
    setRequestId:(value:string|null)=>void;setSubmitting:(value:boolean)=>void;
    setAuthBlocked:(value:boolean)=>void;
 };
 const refresh=()=>{refreshed++};
 return {create,intervals,tick:async()=>{if(active)await active()},cleared:()=>cleared,refreshes:()=>refreshed,refresh};
}

test('Owner pending receipt checks are bounded, per-card, and stop on close',async()=>{
 const h=harness();
 (globalThis as Record<string,unknown>).__fakeOwnerRefresh__=async()=>{h.refresh()};
 try{
  h.create.start();
  assert.deepEqual(h.intervals,[30000],'poll on a bounded 30-second cadence');
  await h.tick();
  assert.equal(h.refreshes(),1);
  h.create.setIssue(5253);
  await h.tick();
  assert.equal(h.refreshes(),1,'a different Issue cannot be polled with a stale timer');
  h.create.setIssue(5252);
  h.create.setRequestId(null);
  await h.tick();
  assert.equal(h.refreshes(),1,'only an outstanding request may poll');
  h.create.setRequestId('pending-uuid');
  h.create.setSubmitting(true);
  await h.tick();
  assert.equal(h.refreshes(),1,'cannot overlap Owner POST with polling');
  h.create.setSubmitting(false);
  h.create.setAuthBlocked(true);
  await h.tick();
  assert.equal(h.refreshes(),1,'401/404 auth gate must not be hammered');
  h.create.setAuthBlocked(false);
  h.create.stop();
  assert.equal(h.cleared(),1);
  await h.tick();
  assert.equal(h.refreshes(),1);
 }finally{delete (globalThis as Record<string,unknown>).__fakeOwnerRefresh__}
});

test('stale generation and hidden-page conditions always suppress polling',()=>{
 const h=harness();
 assert.equal(h.create.canPoll(5252,5,true),true);
 assert.equal(h.create.canPoll(5252,4,true),false);
 assert.equal(h.create.canPoll(5253,5,true),false);
 assert.equal(h.create.canPoll(5252,5,false),false);
 h.create.setRevision(6);
 assert.equal(h.create.canPoll(5252,5,true),false);
});

test('ship same-request terminal cleanup, not a false completion for edited text',()=>{
 assert.ok(dashboard.includes("ownerRequestCanClearDraft(mine.status,mine.requestId,ownerRequestLastId,ownerRequestLastMessage,ownerRequestDraft.value)"));
 assert.ok(dashboard.includes("else if(mine&&['ANSWERED','VERIFIED'].includes(mine.status)&&mine.requestId===ownerRequestLastId){ownerRequestLastId=null;ownerRequestLastMessage=null;ownerRequestRememberDraft()}"));
 assert.ok(dashboard.includes("ownerRequestStatus.textContent='Đang xác minh quyền và lịch sử...';ownerRequestStartPolling(number);ownerRequestRefresh(number)"));
 assert.ok(dashboard.includes("document.body.classList.remove('work-detail-open');ownerRequestStopPolling();ownerRequestRememberDraft();"));
 assert.ok(dashboard.includes("if(r.status===401){ownerRequestPollBlocked=true;"));
 assert.ok(dashboard.includes("if(r.status===404||r.status===405){\n  ownerRequestPollBlocked=true;"));
 assert.ok(!source.includes('localStorage')&&!source.includes('sessionStorage'));
});
