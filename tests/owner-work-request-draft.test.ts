import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// These are the actual pure UI helpers from the shipped Owner Work Center.
const dashboard = readFileSync(new URL('../apps/tigeriq-core/dashboard.html', import.meta.url), 'utf8');
const start = dashboard.indexOf('function ownerRequestCanReuseId(');
const end = dashboard.indexOf('function ownerRequestRecordView(', start);
assert.ok(start > 0 && end > start, 'Owner draft/retry helpers exist in Dashboard');
const { ownerRequestCanReuseId, ownerRequestCanClearDraft } =
  new Function(dashboard.slice(start, end) + '\nreturn {ownerRequestCanReuseId, ownerRequestCanClearDraft};')();

test('same message retry reuses the original request ID; edited text gets a new ID', () => {
  const previous = 'request-1';
  const oldText = 'Xử lý R05 sau xác minh lease.';
  assert.equal(ownerRequestCanReuseId(previous, oldText, oldText), true);
  assert.equal(ownerRequestCanReuseId(previous, oldText, 'Thay đổi chỉ đạo sang R06.'), false);
  assert.equal(ownerRequestCanReuseId(null, oldText, oldText), false);
  assert.equal(ownerRequestCanReuseId(previous, null, oldText), false);
  assert.ok(dashboard.includes('ownerRequestCanReuseId(ownerRequestLastId,ownerRequestLastMessage,message)?ownerRequestLastId:crypto.randomUUID()'),
    'submit must mint a distinct ID if text changed');
  assert.ok(dashboard.includes('ownerRequestLastMessage=message'), 'submit binds ID to exact trimmed text');
});

test('an old response may clear only its own exact submitted revision', () => {
  const oldText = 'Yêu cầu đầu';
  const typedNew = 'Yêu cầu thứ hai đang soạn';
  for (const status of ['ANSWERED', 'VERIFIED']) {
    assert.equal(ownerRequestCanClearDraft(status, 'request-A', 'request-A', oldText, oldText), true);
    assert.equal(ownerRequestCanClearDraft(status, 'request-A', 'request-B', oldText, oldText), false,
      'identical text in a newly reopened or resubmitted card must not be erased by a stale receipt');
    assert.equal(ownerRequestCanClearDraft(status, 'request-A', 'request-A', oldText, typedNew), false,
      'a late result must never erase a newly typed message');
  }
  for (const status of ['RECEIVED', 'PLAN_SHOWN', 'WAITING', 'BLOCKED']) {
    assert.equal(ownerRequestCanClearDraft(status, 'request-A', 'request-A', oldText, oldText), false,
      'nonterminal work must leave current Owner input alone');
  }
  assert.equal(ownerRequestCanClearDraft('VERIFIED', 'request-A', 'request-A', null, oldText), false);
  assert.equal(ownerRequestCanClearDraft('ANSWERED', 'request-A', 'request-A', oldText, oldText + ' mới'), false);
  assert.ok(dashboard.includes('ownerRequestCanClearDraft(mine.status,mine.requestId,ownerRequestLastId,ownerRequestLastMessage,ownerRequestDraft.value)'),
    'asynchronous history readback must check the submitted revision');
  assert.ok(dashboard.includes('ownerRequestCanClearDraft(record.status,requestId,ownerRequestLastId,message,ownerRequestDraft.value)'),
    'submit acknowledgement must check the submitted revision');
});

test('opening another issue resets text ownership and finished old ID cannot be reused', () => {
  assert.ok(dashboard.includes('ownerRequestLastId=null;ownerRequestLastMessage=null;ownerRequestDraft.value='),
    'switching cards resets both the request ID and its bound draft');
  assert.ok(dashboard.includes("else if(ownerRequestLastId===requestId&&['ANSWERED','VERIFIED'].includes(record.status)){ownerRequestLastId=null;ownerRequestLastMessage=null}"),
    'a terminal old result leaves edited draft in place while discarding old ID');
  assert.equal(ownerRequestCanReuseId('old-id', 'old', 'new'), false);
});

test('late request and history reads from an earlier modal generation cannot mutate reopened card', () => {
  assert.ok(dashboard.includes('const revision=ownerRequestRevision;'),
    'GET history must capture the current modal generation before network IO');
  assert.ok(dashboard.includes('if(number!==ownerRequestIssueNumber||revision!==ownerRequestRevision)return;'),
    'GET history must drop a response after close or reopen even for the same Issue');
  assert.ok(dashboard.includes('if(issueNumber!==ownerRequestIssueNumber||revision!==ownerRequestRevision||ownerRequestLastId!==requestId)return;'),
    'POST acknowledgment must reject a stale Issue generation or receipt ID');
  assert.ok(dashboard.includes('function ownerRequestOpen(number){ownerRequestRevision++;ownerRequestSubmitting=false;'),
    'every new modal open must get a unique generation');
  assert.ok(dashboard.includes('ownerRequestRevision++;ownerRequestSubmitting=false;ownerRequestIssueNumber=null;workDetailRow=null;'),
    'modal close must invalidate pending responses before a same-card reopen');
  assert.ok(dashboard.includes('if(issueNumber===ownerRequestIssueNumber&&revision===ownerRequestRevision){ownerRequestSubmitting=false;'),
    'old finally branch must not enable controls in the newly reopened modal');
});

test('duplicate click is blocked while a POST is in flight, including history refresh', () => {
  assert.ok(dashboard.includes('if(!workDetailRow||!ownerRequestSecure()||ownerRequestSubmitting)return;'));
  assert.ok(dashboard.includes("ownerRequestSubmitting=true;ownerRequestSend.disabled=true;"));
  assert.ok(dashboard.includes('ownerRequestSend.disabled=ownerRequestSubmitting;ownerWorkSecureLink.hidden=true;'),
    'history GET cannot re-enable Submit during active POST and trigger a duplicate');
});
