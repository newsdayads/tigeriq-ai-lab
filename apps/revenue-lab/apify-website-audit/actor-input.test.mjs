import test from 'node:test';
import assert from 'node:assert/strict';
import { requireActorAuditUrl, auditStartLogMessage, auditFailureCode, auditFailureLogMessage } from './actor-input.mjs';
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
 
test('Actor failure logging redacts unknown errors, network details and URL credentials', () => {
  const secret = 'https://user:password@example.com/?access_token=DO_NOT_PRINT';
  const examples = [
    [new Error('Failed to request ' + secret), 'AUDIT_FAILURE'],
    [new AuditError('DNS_FAILURE', 'DNS for ' + secret, { rawUrl: secret }), 'DNS_FAILURE'],
    [new AuditError('RAW_TOKEN_' + secret, 'Unexpected: ' + secret), 'AUDIT_FAILURE'],
    [null, 'AUDIT_FAILURE'],
  ];
  for (const [error, expectedCode] of examples) {
    const line = auditFailureLogMessage(error);
    assert.equal(auditFailureCode(error), expectedCode);
    assert.equal(line, `Audit failed [${expectedCode}].`);
    for (const forbidden of ['password', 'access_token', 'DO_NOT_PRINT', secret])
      assert.equal(line.includes(forbidden), false);
  }
});
