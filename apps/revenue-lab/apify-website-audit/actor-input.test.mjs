import test from 'node:test';
import assert from 'node:assert/strict';
import { requireActorAuditUrl, auditStartLogMessage } from './actor-input.mjs';
import { auditWebsite, AuditError } from './audit-engine.mjs';

test('Actor refuses missing/empty/non-string required URL before any network request', async () => {
  for (const input of [undefined, null, {}, {url:''}, {url:'   '},
    {url:null}, {url:42}, {url:false}, {url:{href:'https://example.com/'}}]) {
    assert.throws(() => requireActorAuditUrl(input),
      error => error instanceof AuditError && error.code === 'INVALID_URL');
  }
  let fetchAttempts = 0;
  await assert.rejects(
    () => auditWebsite(requireActorAuditUrl({url:'https://example.com/'}),
      {resolveTargetFn:()=>{fetchAttempts++; throw Error('NOT_CALLED');}}),
    error => error instanceof AuditError && error.code === 'AUDIT_FAILURE' &&
      error.detail === 'NOT_CALLED');
  assert.equal(fetchAttempts,1,'valid URL still enters real audit request path');
});

test('Actor start message never contains raw target URL, secrets, credentials, or query',()=>{
  const supplied='https://user:password@example.com/?token=SECRET_DO_NOT_LOG#private';
  const target=requireActorAuditUrl({url:supplied});
  assert.equal(target,supplied,'input is preserved for normal audit validation');
  const log=auditStartLogMessage();
  assert.match(log,/Starting website audit/);
  for (const forbidden of ['user','password','token','SECRET_DO_NOT_LOG',
    'example.com','private',supplied])assert.ok(!log.includes(forbidden),forbidden);
});
