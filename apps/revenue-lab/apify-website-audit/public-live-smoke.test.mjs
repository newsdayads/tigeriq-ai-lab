import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPublicHttpEvidence, PUBLIC_SMOKE_OPTIONS, PUBLIC_SMOKE_TARGET } from './public-live-smoke.mjs';

function validProof() {
  return {
    schemaVersion: '1.0',
    status: 'success',
    requestedUrl: PUBLIC_SMOKE_TARGET,
    completedAt: '2026-10-20T10:00:00.000Z',
    metrics: {
      pagesAudited: 1, errorCount: 0, externalApiCostUSD: 0,
      platformCostUSD: null, platformCostStatus: 'pending_private_apify_run',
    },
    pages: [{ url: 'https://example.com/', statusCode: 200, bytes: 1234, seo: { title: 'Example Domain' } }],
  };
}

test('public smoke checks actual audit response and reports only public, non-Apify evidence', async () => {
  let called = 0;
  const report = await collectPublicHttpEvidence({
    auditFn: async (target, options) => {
      called++;
      assert.equal(target, 'https://example.com/');
      assert.deepEqual(options, PUBLIC_SMOKE_OPTIONS);
      return validProof();
    },
  });
  assert.equal(called, 1);
  assert.equal(report.evidenceSchema, 'TIGERIQ_REVENUE_PUBLIC_HTTP_LIVE_V1');
  assert.equal(report.auditStatus, 'success');
  assert.equal(report.httpStatus, 200);
  assert.equal(report.pagesAudited, 1);
  assert.equal(report.titlePresent, true);
  assert.equal(report.apifyActorRan, false);
  assert.equal(report.apifyPlatformCostUsd, null);
  assert.equal(report.platformBillingVerified, false);
  assert.equal(report.paidRevenueVerified, false);
  assert.equal(report.fullWorkOrderAccepted, false);
  assert.ok(!JSON.stringify(report).includes('TOKEN'));
});

test('smoke rejects spoofed success, malformed outputs and nonpublic redirects', async () => {
  const variants = [
    x => { x.status = 'partial'; },
    x => { x.requestedUrl = 'https://something-else.example/'; },
    x => { x.metrics.pagesAudited = 0; },
    x => { x.metrics.errorCount = 1; },
    x => { x.metrics.platformCostUSD = 0; },
    x => { x.metrics.externalApiCostUSD = 0.1; },
    x => { x.pages[0].bytes = 0; },
    x => { x.pages[0].statusCode = 503; },
    x => { x.pages[0].url = 'http://example.com/'; },
    x => { x.pages[0].url = 'https://internal.example.com/'; },
  ];
  for (const mutate of variants) {
    const result = validProof();
    mutate(result);
    await assert.rejects(
      () => collectPublicHttpEvidence({ auditFn: async () => result }),
      /PUBLIC_HTTP_AUDIT_EVIDENCE_INVALID|PUBLIC_HTTP_TARGET_ORIGIN_MISMATCH/);
  }
});
