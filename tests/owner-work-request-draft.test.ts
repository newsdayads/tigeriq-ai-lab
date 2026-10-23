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
    assert.equal(ownerRequestCanClearDraft(status, oldText, oldText), true);
    assert.equal(ownerRequestCanClearDraft(status, oldText, typedNew), false,
      'a late result must never erase a newly typed message');
  }
  for (const status of ['RECEIVED', 'PLAN_SHOWN', 'WAITING', 'BLOCKED']) {
    assert.equal(ownerRequestCanClearDraft(status, oldText, oldText), false,
      'nonterminal work must leave current Owner input alone');
  }
  assert.equal(ownerRequestCanClearDraft('VERIFIED', null, oldText), false);
  assert.equal(ownerRequestCanClearDraft('ANSWERED', oldText, oldText + ' mới'), false);
  assert.ok(dashboard.includes('ownerRequestCanClearDraft(mine.status,ownerRequestLastMessage,ownerRequestDraft.value)'),
    'asynchronous history readback must check the submitted revision');
  assert.ok(dashboard.includes('ownerRequestCanClearDraft(record.status,message,ownerRequestDraft.value)'),
    'submit acknowledgement must check the submitted revision');
});

test('opening another issue resets text ownership and finished old ID cannot be reused', () => {
  assert.ok(dashboard.includes('ownerRequestLastId=null;ownerRequestLastMessage=null;ownerRequestDraft.value='),
    'switching cards resets both the request ID and its bound draft');
  assert.ok(dashboard.includes("else if(['ANSWERED','VERIFIED'].includes(record.status)){ownerRequestLastId=null;ownerRequestLastMessage=null}"),
    'a terminal old result leaves edited draft in place while discarding old ID');
  assert.equal(ownerRequestCanReuseId('old-id', 'old', 'new'), false);
});
