// GH-2293: one real zero-paid-API public HTTP audit on GitHub Actions.
// Not an Apify Actor invocation, invoice, private platform run or production launch.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { auditWebsite } from './audit-engine.mjs';
import { renderWebsiteAuditMarkdown } from './website-report.mjs';

export const PUBLIC_SMOKE_TARGET = 'https://example.com/';
export const PUBLIC_SMOKE_OPTIONS = Object.freeze({
  maxPages: 1,
  timeoutMs: 12000,
  maxBytes: 512 * 1024,
  maxRedirects: 2,
  requestDelayMs: 0,
});

export async function collectPublicHttpEvidence({ auditFn = auditWebsite } = {}) {
  const result = await auditFn(PUBLIC_SMOKE_TARGET, { ...PUBLIC_SMOKE_OPTIONS });
  const page = result?.pages?.[0];
  if (result?.schemaVersion !== '1.0' ||
      result?.status !== 'success' ||
      result?.requestedUrl !== PUBLIC_SMOKE_TARGET ||
      result?.metrics?.pagesAudited !== 1 ||
      result?.metrics?.errorCount !== 0 ||
      !Array.isArray(result?.pages) || result.pages.length !== 1 ||
      !Number.isInteger(page?.statusCode) || page.statusCode < 200 ||
      page.statusCode >= 300 ||
      !Number.isInteger(page?.bytes) || page.bytes <= 0 ||
      result?.metrics?.externalApiCostUSD !== 0 ||
      result?.metrics?.platformCostUSD !== null ||
      result?.metrics?.platformCostStatus !== 'pending_private_apify_run') {
    throw Error('PUBLIC_HTTP_AUDIT_EVIDENCE_INVALID');
  }
  const final = new URL(page.url);
  if (final.protocol !== 'https:' ||
      (final.hostname !== 'example.com' && final.hostname !== 'www.example.com')) {
    throw Error('PUBLIC_HTTP_TARGET_ORIGIN_MISMATCH');
  }
  const reportMarkdown = renderWebsiteAuditMarkdown(result);
  return Object.freeze({
    evidenceSchema: 'TIGERIQ_REVENUE_PUBLIC_HTTP_LIVE_V1',
    evidenceClass: 'REAL_EXTERNAL_PUBLIC_HTTP_NOT_APIFY',
    target: PUBLIC_SMOKE_TARGET,
    verifiedSourceRevision: process.env.TIGERIQ_VERIFIED_SOURCE_SHA || null,
    completedAt: result.completedAt,
    auditStatus: result.status,
    httpStatus: page.statusCode,
    pagesAudited: result.metrics.pagesAudited,
    responseBytes: page.bytes,
    titlePresent: Boolean(page?.seo?.title),
    productReportFormat: 'TIGERIQ_SEO_MARKDOWN_V1',
    actionableFindings: result.findingsSummary,
    productReportMarkdown: reportMarkdown,
    htmlDerived: true,
    externalPaidApiCostUsd: result.metrics.externalApiCostUSD,
    apifyActorRan: false,
    apifyPlatformCostUsd: null,
    platformBillingVerified: false,
    paidRevenueVerified: false,
    fullWorkOrderAccepted: false,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  collectPublicHttpEvidence().then(evidence => {
    process.stdout.write('TIGERIQ_REVENUE_PUBLIC_LIVE_EVIDENCE=' +
      JSON.stringify(evidence) + '\n');
  }).catch(() => {
    // No raw upstream URL, response or exception text in a CI error message.
    process.stderr.write('PUBLIC_HTTP_AUDIT_SMOKE_FAILED\n');
    process.exitCode = 1;
  });
}
