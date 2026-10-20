// GH-2293: real public HTTPS audit through the local HTTP UI POST endpoint.
// No Apify Actor, paid platform call, Production deploy, or owner-device action.
import { createHash } from 'node:crypto';
import { startWebsiteAuditUi } from './website-ui.mjs';

const TARGET = 'https://example.com/';

export async function collectPublicUiLiveEvidence({ startUiFn = startWebsiteAuditUi, fetchFn = fetch } = {}) {
  const { server, origin } = await startUiFn({ port: 0 });
  try {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
        server.address()?.address !== '127.0.0.1') {
      throw Error('PUBLIC_UI_NOT_LOOPBACK');
    }
    const health = await fetchFn(origin + '/health');
    if (health.status !== 200) throw Error('PUBLIC_UI_HEALTH_FAILED');
    const state = await health.json();
    if (state.status !== 'ok' || state.mode !== 'local_only' || state.apifyActorRan !== false) {
      throw Error('PUBLIC_UI_HEALTH_INVALID');
    }

    const response = await fetchFn(origin + '/api/audit', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: TARGET, maxPages: 1 }),
    });
    if (response.status !== 200) throw Error('PUBLIC_UI_AUDIT_HTTP_FAILED');
    const result = await response.json();
    const markdown = result?.markdown;
    if (result?.status !== 'success' || result?.format !== 'markdown' ||
        result?.apifyActorRan !== false || result?.platformBillingVerified !== false ||
        typeof markdown !== 'string' || markdown.length > 12000 ||
        !markdown.startsWith('# TigerIQ Website Audit — SEO Report\n') ||
        !markdown.includes('Audit: success\n') ||
        !markdown.includes('Pages audited: 1\n') ||
        !markdown.includes('HTTP status: 200\n') ||
        !markdown.includes('## Page 1: https://example\\.com/\n') ||
        !markdown.includes('Apify platform cost: NOT VERIFIED') ||
        !markdown.includes('Paid external API cost for this audit logic: USD 0.')) {
      throw Error('PUBLIC_UI_OUTPUT_INVALID');
    }
    const counts = markdown.match(/^Findings: (\d+) \(high (\d+), medium (\d+), low (\d+)\)$/m);
    if (!counts || counts.slice(1).some(x => !Number.isSafeInteger(Number(x)))) {
      throw Error('PUBLIC_UI_FINDINGS_INVALID');
    }
    const [total, high, medium, low] = counts.slice(1).map(Number);
    if (total !== high + medium + low || total > 4) {
      throw Error('PUBLIC_UI_FINDINGS_INVALID');
    }
    return Object.freeze({
      evidenceSchema: 'TIGERIQ_REVENUE_PUBLIC_UI_REAL_E2E_V1',
      evidenceClass: 'REAL_PUBLIC_HTTPS_THROUGH_LOCAL_UI_BACKEND_NOT_BROWSER_CLICK_NOT_APIFY',
      sourceRevision: process.env.TIGERIQ_VERIFIED_SOURCE_SHA || null,
      target: TARGET,
      route: 'POST /api/audit',
      loopbackBound: true,
      auditStatus: 'success',
      pagesAudited: 1,
      issueCounts: { total, high, medium, low },
      productReportFormat: 'TIGERIQ_SEO_MARKDOWN_V1',
      reportSha256: createHash('sha256').update(markdown, 'utf8').digest('hex'),
      productReportMarkdown: markdown,
      apifyActorRan: false,
      apifyPlatformCostUsd: null,
      platformBillingVerified: false,
      externalPaidApiCostUsd: 0,
      productWorkOrderDone: false,
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
