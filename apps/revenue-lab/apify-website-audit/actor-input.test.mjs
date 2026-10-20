import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { requireActorAuditUrl, auditStartLogMessage, auditFailureCode, auditFailureLogMessage, auditFailureOutput } from './actor-input.mjs';
import { auditWebsite, AuditError, actionableSeoFindings } from './audit-engine.mjs';

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

test('actionable SEO rules are bounded, transparent and do not invent ranking scores', () => {
  const failures = actionableSeoFindings({
    title: '', metaDescription: null, h1Count: 0,
  });
  assert.deepEqual(failures.map(x => [x.code, x.severity]), [
    ['MISSING_TITLE', 'high'],
    ['MISSING_META_DESCRIPTION', 'medium'],
    ['MISSING_H1', 'medium'],
  ]);
  assert.ok(failures.every(x => typeof x.recommendation === 'string' && x.recommendation.length > 10));
  const duplicates = actionableSeoFindings({
    title: 'Audit Title', metaDescription: 'Meta Description', h1Count: 2,
  });
  assert.deepEqual(duplicates.map(x => x.code), ['MULTIPLE_H1']);
  assert.deepEqual(actionableSeoFindings({
    title: 'Audit Title', metaDescription: 'Meta Description', h1Count: 1,
  }), []);
});

test('required CI gate verifies full crawl-to-actionable-report integration against actual HTTP HTML', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><title>Good title</title><h1>Useful heading</h1></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const target = `http://audit.test:${server.address().port}/`;
    const report = await auditWebsite(target, {
      maxPages: 1,
      resolveTargetFn: async () => ({ address: '127.0.0.1', family: 4 }),
    });
    assert.equal(report.status, 'success');
    assert.equal(report.metrics.pagesAudited, 1);
    assert.deepEqual(report.pages[0].findings.map(x => x.code),
      ['MISSING_META_DESCRIPTION']);
    assert.deepEqual(report.findingsSummary, {
      total: 1, high: 0, medium: 1, low: 0, pagesWithFindings: 1,
    });
    assert.equal(report.metrics.platformCostUSD, null);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});


test('Actor persists only safe fixed-code failure evidence for credential-bearing exceptions', () => {
  const secret = 'https://user:password@example.com/?session=UNREDACTED_TOKEN#internal';
  for (const error of [
    new Error('Network error while fetching ' + secret),
    new AuditError('DNS_FAILURE', 'DNS lookup leaked ' + secret, { url: secret }),
    new AuditError('INJECTED_' + secret, 'Untrusted code: ' + secret),
    null,
  ]) {
    const output = auditFailureOutput(error);
    assert.equal(output.schemaVersion, '1.0');
    assert.equal(output.status, 'failed');
    assert.equal(output.requestedUrl, null);
    assert.equal(output.error.code, auditFailureCode(error));
    assert.equal(output.error.message, auditFailureLogMessage(error));
    assert.equal(output.error.detail, null);
    assert.equal(output.metrics.externalApiCostUSD, 0);
    assert.equal(output.metrics.platformCostUSD, null);
    assert.equal(output.metrics.platformCostStatus, 'pending_private_apify_run');
    const serialized = JSON.stringify(output);
    for (const forbidden of ['password', 'session=', 'UNREDACTED_TOKEN', secret, 'INJECTED_']) {
      assert.ok(!serialized.includes(forbidden), 'sensitive data appeared in stored OUTPUT');
    }
  }
});

test('Actor catch writes sanitized failure OUTPUT without missing AuditError reference or raw exception fields', () => {
  const source = readFileSync(new URL('./actor.mjs', import.meta.url), 'utf8');
  assert.match(source, /Actor\.setValue\('OUTPUT', auditFailureOutput\(error\)\)/);
  assert.doesNotMatch(source, /\binstanceof AuditError\b/);
  assert.doesNotMatch(source, /\berror\.(?:message|detail)\b/);
  assert.doesNotMatch(source, /requestedUrl:\s*url/);
});
