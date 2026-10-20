// Include browser-download regressions in the required Revenue Actor CI test job.
import './website-ui-export.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPublicHttpEvidence, PUBLIC_SMOKE_OPTIONS, PUBLIC_SMOKE_TARGET } from './public-live-smoke.mjs';
import { startWebsiteAuditUi } from './website-ui.mjs';
import { collectPublicUiLiveEvidence } from './public-ui-live-e2e.mjs';

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
    findingsSummary: { total: 1, high: 0, medium: 1, low: 0, pagesWithFindings: 1 },
    pages: [{
      url: 'https://example.com/', statusCode: 200, bytes: 1234,
      seo: { title: 'Example Domain', metaDescription: null, h1Count: 1 },
      findings: [{
        code: 'MISSING_META_DESCRIPTION', severity: 'medium',
        recommendation: 'Add a concise meta description for search snippets.',
      }],
    }],
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
  assert.equal(report.productReportFormat, 'TIGERIQ_SEO_MARKDOWN_V1');
  assert.deepEqual(report.actionableFindings,
    { total: 1, high: 0, medium: 1, low: 0, pagesWithFindings: 1 });
  assert.match(report.productReportMarkdown, /# TigerIQ Website Audit/);
  assert.match(report.productReportMarkdown, /MISSING_META_DESCRIPTION/);
  assert.match(report.productReportMarkdown, /Apify platform cost: NOT VERIFIED/);
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
    x => { x.findingsSummary.total = 999; },
    x => { x.pages[0].findings[0].recommendation = 'fake audit recommendation'; },
    x => { x.pages[0].findings[0].code = 'INVENTED_RANK_SCORE'; },
  ];
  for (const mutate of variants) {
    const result = validProof();
    mutate(result);
    await assert.rejects(
      () => collectPublicHttpEvidence({ auditFn: async () => result }),
      /PUBLIC_HTTP_AUDIT_EVIDENCE_INVALID|PUBLIC_HTTP_TARGET_ORIGIN_MISMATCH|REPORT_[A-Z_]+/);
  }
});

test('live report strips query credentials and is constructed from inspected page evidence', async () => {
  const result = validProof();
  result.pages[0].url = 'https://example.com/public?api_key=DO_NOT_PRINT&token=DO_NOT_PRINT';
  result.pages[0].seo.title = 'Example *Markdown*';
  const report = await collectPublicHttpEvidence({ auditFn: async () => result });
  assert.ok(report.productReportMarkdown.includes('Example \\*Markdown\\*'));
  assert.ok(!report.productReportMarkdown.includes('DO_NOT_PRINT'));
  assert.ok(!report.productReportMarkdown.includes('api_key'));
  assert.ok(!report.productReportMarkdown.includes('token='));
  assert.ok(report.productReportMarkdown.includes('example\\.com/public'));
});


test('browser UI serves local-only page and responds with real product-shaped Markdown over HTTP', async () => {
  let calls = 0;
  const { server, origin } = await startWebsiteAuditUi({
    auditFn: async (url, options) => {
      calls++;
      assert.equal(url, 'https://example.com/');
      assert.equal(options.maxPages, 1);
      assert.equal(options.timeoutMs, 8000);
      return validProof();
    },
  });
  try {
    assert.equal(server.address().address, '127.0.0.1', 'server must never bind a public interface');
    const page = await fetch(origin + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await page.text();
    assert.match(html, /TigerIQ Website Audit/);
    assert.match(html, /textContent = result.markdown/);
    assert.doesNotMatch(html, /\.innerHTML\s*=/);

    const health = await fetch(origin + '/health');
    assert.deepEqual(await health.json(), { status: 'ok', mode: 'local_only', apifyActorRan: false });

    const run = await fetch(origin + '/api/audit', {
      method: 'POST',
      headers: { 'Origin': origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/', maxPages: 1 }),
    });
    assert.equal(run.status, 200);
    const data = await run.json();
    assert.equal(data.status, 'success');
    assert.equal(data.format, 'markdown');
    assert.match(data.markdown, /MISSING_META_DESCRIPTION/);
    assert.match(data.markdown, /Apify platform cost: NOT VERIFIED/);
    assert.equal(data.apifyActorRan, false);
    assert.equal(data.platformBillingVerified, false);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('browser UI rejects cross-origin, malformed, oversized requests without leaking URLs or running audit', async () => {
  let calls = 0;
  const { server, origin } = await startWebsiteAuditUi({
    auditFn: async () => { calls++; throw Error('SHOULD_NOT_EXECUTE'); },
  });
  const secret = 'https://example.com/?access_token=LEAK_THIS_NEVER';
  try {
    const probes = [
      { origin: 'http://evil.example', type: 'application/json', body: JSON.stringify({ url: secret }), status: 403 },
      { origin, type: 'text/plain', body: JSON.stringify({ url: secret }), status: 403 },
      { origin, type: 'application/json', body: '{ invalid json', status: 422 },
      { origin, type: 'application/json', body: JSON.stringify({ url: secret, maxPages: 100 }), status: 422 },
      { origin, type: 'application/json', body: JSON.stringify({ url: secret, pad: 'x'.repeat(4096) }), status: 413 },
    ];
    for (const probe of probes) {
      const response = await fetch(origin + '/api/audit', {
        method: 'POST', headers: { Origin: probe.origin, 'Content-Type': probe.type },
        body: probe.body,
      });
      assert.equal(response.status, probe.status);
      const body = await response.text();
      assert.ok(!body.includes('LEAK_THIS_NEVER'));
      assert.ok(!body.includes(secret));
    }
    assert.equal(calls, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});


test('full localhost HTTP POST E2E returns reproducible SEO report evidence and cryptographic digest', async () => {
  const result = await collectPublicUiLiveEvidence({
    startUiFn: options => startWebsiteAuditUi({
      ...options,
      auditFn: async (target, auditOptions) => {
        assert.equal(target, 'https://example.com/');
        assert.equal(auditOptions.maxPages, 1);
        return validProof();
      },
    }),
  });
  assert.equal(result.evidenceSchema, 'TIGERIQ_REVENUE_PUBLIC_UI_REAL_E2E_V1');
  assert.equal(result.loopbackBound, true);
  assert.equal(result.route, 'POST /api/audit');
  assert.deepEqual(result.issueCounts, { total: 1, high: 0, medium: 1, low: 0 });
  assert.match(result.productReportMarkdown, /MISSING_META_DESCRIPTION/);
  assert.match(result.reportSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.apifyActorRan, false);
  assert.equal(result.apifyPlatformCostUsd, null);
  assert.equal(result.productWorkOrderDone, false);
});

test('local UI public E2E refuses failed audit, never manufactures a live report', async () => {
  await assert.rejects(() => collectPublicUiLiveEvidence({
    startUiFn: options => startWebsiteAuditUi({
      ...options,
      auditFn: async () => { throw Error('private-url-token=DO_NOT_LOG'); },
    }),
  }), /PUBLIC_UI_AUDIT_HTTP_FAILED/);
});
