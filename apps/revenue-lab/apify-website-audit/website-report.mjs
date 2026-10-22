// GH-2293: standalone, real HTTP website audit report (not a private Apify run).
// Output contains observations and remediation only, never invented scores/cost.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { auditWebsite } from './audit-engine.mjs';

const KNOWN_FINDINGS = Object.freeze({
  MISSING_TITLE: { severity: 'high', recommendation: 'Add a descriptive HTML title for this page.' },
  MISSING_META_DESCRIPTION: { severity: 'medium', recommendation: 'Add a concise meta description for search snippets.' },
  MISSING_H1: { severity: 'medium', recommendation: 'Add one meaningful H1 heading describing the page.' },
  MULTIPLE_H1: { severity: 'low', recommendation: 'Review H1 headings and keep the primary heading clear.' },
});

function markdownText(value, max = 160) {
  // Source HTML character references may have been decoded into literal tags.
  // Markdown can allow raw HTML, so escape HTML-sensitive characters before
  // Markdown punctuation; otherwise an untrusted title can inject markup into
  // a downloaded report even though the browser preview uses textContent.
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, max)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\\`*_{}\[\]()#+.!|~-])/g, '\\$1');
}

function displayPageUrl(value) {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || !['https:', 'http:'].includes(parsed.protocol)) {
    throw Error('REPORT_INVALID_URL');
  }
  // Query strings and fragments can carry credentials: never render them.
  return markdownText(parsed.origin + parsed.pathname, 260);
}

export function renderWebsiteAuditMarkdown(result) {
  if (result?.schemaVersion !== '1.0' ||
      !['success', 'partial'].includes(result.status) ||
      !Array.isArray(result.pages) || result.pages.length < 1 ||
      result.pages.length > 10 ||
      result.metrics?.pagesAudited !== result.pages.length ||
      result.metrics?.externalApiCostUSD !== 0 ||
      result.metrics?.platformCostUSD !== null ||
      result.metrics?.platformCostStatus !== 'pending_private_apify_run') {
    throw Error('REPORT_SOURCE_INVALID');
  }
  const tally = { total: 0, high: 0, medium: 0, low: 0, pagesWithFindings: 0 };
  const lines = [
    '# TigerIQ Website Audit — SEO Report',
    '',
    'Source: real bounded HTTP/HTTPS HTML analysis; not Google rankings or Lighthouse.',
    'Audit: ' + result.status,
    'Pages audited: ' + result.pages.length,
  ];
  if (result.status === 'partial') {
    // Show a bounded skipped-page count, never the failing URL or upstream error.
    const skipped = result.metrics?.errorCount;
    if (!Number.isInteger(skipped) || skipped < 1 || skipped > 10) {
      throw Error('REPORT_PARTIAL_COUNT_INVALID');
    }
    lines.push('Pages skipped due to errors: ' + skipped);
  }
  for (const [index, page] of result.pages.entries()) {
    if (!Number.isInteger(page.statusCode) || page.statusCode < 200 || page.statusCode >= 300 ||
        !Array.isArray(page.findings) || page.findings.length > 4 || typeof page.url !== 'string') {
      throw Error('REPORT_PAGE_INVALID');
    }
    lines.push('', '## Page ' + (index + 1) + ': ' + displayPageUrl(page.url));
    lines.push('HTTP status: ' + page.statusCode);
    lines.push('Title: ' + (page.seo?.title ? markdownText(page.seo.title) : '(missing)'));
    if (page.findings.length) tally.pagesWithFindings++;
    for (const finding of page.findings) {
      const expected = Object.hasOwn(KNOWN_FINDINGS, finding?.code) ? KNOWN_FINDINGS[finding.code] : null;
      if (!expected || finding.severity !== expected.severity ||
          finding.recommendation !== expected.recommendation) {
        throw Error('REPORT_FINDING_INVALID');
      }
      tally.total++;
      tally[finding.severity]++;
      lines.push('- ' + finding.severity.toUpperCase() + ': ' + finding.code +
        ' — ' + expected.recommendation);
    }
    if (!page.findings.length) lines.push('- No issues detected by the four supported HTML rules.');
  }
  if (['total', 'high', 'medium', 'low', 'pagesWithFindings'].some(
    key => result.findingsSummary?.[key] !== tally[key])) {
    throw Error('REPORT_FINDING_TOTAL_MISMATCH');
  }
  lines.splice(5, 0, 'Findings: ' + tally.total +
    ' (high ' + tally.high + ', medium ' + tally.medium + ', low ' + tally.low + ')');
  lines.push('', 'Apify platform cost: NOT VERIFIED (no private Actor run billed or checked).',
    'Paid external API cost for this audit logic: USD 0.',
    'Coverage: HTML title, meta description, H1 count. No ranking/performance/JS claims.');
  const markdown = lines.join('\n');
  if (markdown.length > 12000) throw Error('REPORT_TOO_LARGE');
  return markdown;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // Safe zero-cost local command: node website-report.mjs https://example.com/
  const target = process.argv[2];
  if (process.argv.length !== 3 || !target) {
    process.stderr.write('WEBSITE_AUDIT_URL_REQUIRED\n');
    process.exitCode = 2;
  } else {
    auditWebsite(target).then(result => {
      process.stdout.write(renderWebsiteAuditMarkdown(result) + '\n');
    }).catch(() => {
      // DNS/socket exception text may contain user-supplied sensitive URLs.
      process.stderr.write('WEBSITE_AUDIT_FAILED\n');
      process.exitCode = 1;
    });
  }
}
