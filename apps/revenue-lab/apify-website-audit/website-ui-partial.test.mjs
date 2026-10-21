// GH-2293 — partial SEO crawl must not erase an otherwise valid report.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { startWebsiteAuditUi } from './website-ui.mjs';

function partialAuditProof() {
  return {
    schemaVersion: '1.0',
    status: 'partial',
    metrics: {
      pagesAudited: 1, errorCount: 1, externalApiCostUSD: 0,
      platformCostUSD: null, platformCostStatus: 'pending_private_apify_run',
    },
    pages: [{
      url: 'https://example.com/', statusCode: 200,
      seo: { title: 'Example Domain', metaDescription: null, h1Count: 1 },
      findings: [{
        code: 'MISSING_META_DESCRIPTION', severity: 'medium',
        recommendation: 'Add a concise meta description for search snippets.',
      }],
    }],
    errors: [{ url: 'https://example.com/broken?token=PRIVATE_VALUE', code: 'NON_2XX' }],
    findingsSummary: { total: 1, high: 0, medium: 1, low: 0, pagesWithFindings: 1 },
  };
}

test('HTTP API exposes genuine partial audit and useful report without leaking failing URLs', async () => {
  const { server, origin } = await startWebsiteAuditUi({
    auditFn: async () => partialAuditProof(),
  });
  try {
    const response = await fetch(origin + '/api/audit', {
      method: 'POST',
      headers: { origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/', maxPages: 2 }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.status, 'partial');
    assert.deepEqual(json.overview, {
      pagesAudited: 1, pagesSkipped: 1, high: 0, medium: 1, low: 0,
    });
    assert.equal(json.apifyActorRan, false);
    assert.equal(json.platformBillingVerified, false);
    assert.match(json.markdown, /Audit: partial/);
    assert.match(json.markdown, /Pages skipped due to errors: 1/);
    assert.match(json.markdown, /MISSING_META_DESCRIPTION/);
    assert.doesNotMatch(json.markdown, /PRIVATE_VALUE|\/broken\?/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('browser presents and exports partial reports with explicit warning, not generic failure', async () => {
  const { server, origin } = await startWebsiteAuditUi({
    auditFn: async () => partialAuditProof(),
  });
  try {
    const html = await (await fetch(origin + '/')).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    let onSubmit;
    const controls = {
      'audit-form': { addEventListener: (_name, cb) => { onSubmit = cb; } },
      submit: { disabled: false },
      status: { textContent: '' },
      report: { textContent: '' },
      overview: { hidden: true },
      'metric-pages': { textContent: '' },
      'metric-high': { textContent: '' },
      'metric-medium': { textContent: '' },
      'metric-low': { textContent: '' },
      'metric-skipped': { textContent: '' },

      download: { hidden: true, href: '', removeAttribute() { this.href = ''; } },
      site: { value: 'https://example.com/' },
      pages: { value: '2' },
    };
    const body = '# TigerIQ Website Audit\nAudit: partial\nPages audited: 1';
    vm.runInNewContext(script, {
      document: { getElementById: key => controls[key] },
      Blob,
      URL: {
        createObjectURL: () => 'blob:partial-report',
        revokeObjectURL: () => {},
      },
      fetch: async () => ({
        ok: true,
        json: async () => ({ status: 'partial', markdown: body, overview: {pagesAudited:1,pagesSkipped:1,high:0,medium:1,low:0} }),
      }),
    });
    await onSubmit({ preventDefault() {} });
    assert.equal(controls.report.textContent, body);
    assert.equal(controls.overview.hidden, false);
    assert.equal(controls['metric-pages'].textContent, '1');
    assert.equal(controls['metric-skipped'].textContent, '1');
    assert.equal(controls['metric-medium'].textContent, '1');
    assert.equal(controls.download.hidden, false);
    assert.equal(controls.download.href, 'blob:partial-report');
    assert.match(controls.status.textContent, /một phần/);
    assert.equal(controls.submit.disabled, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
