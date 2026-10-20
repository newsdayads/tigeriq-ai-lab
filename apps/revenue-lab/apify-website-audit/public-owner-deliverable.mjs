// GH-2293: downloadable owner-facing result for a real, public example.com demo.
// Never equate the CI public website audit with a private Apify run or invoice.
import { createHash } from 'node:crypto';

const TARGET = 'https://example.com/';
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const REPORT_PREFIX = '# TigerIQ Website Audit — SEO Report\n';
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const fail = () => { throw Error('OWNER_PUBLIC_DEMO_EVIDENCE_INVALID'); };

function validatedMarkdown(value) {
  if (typeof value !== 'string' || !value.startsWith(REPORT_PREFIX) ||
      value.length > 12000 || !value.includes('Audit: success\n') ||
      !value.includes('Pages audited: 1\n') ||
      !value.includes('HTTP status: 200\n') ||
      !value.includes('## Page 1: https://example\\.com/\n') ||
      !value.includes('Apify platform cost: NOT VERIFIED') ||
      !value.includes('Paid external API cost for this audit logic: USD 0.')) fail();
  return value;
}

export function buildOwnerPublicDemo({ direct, ui, sourceSha, runId } = {}) {
  if (typeof sourceSha !== 'string' || !SHA.test(sourceSha) ||
      typeof runId !== 'string' || !/^[1-9]\d{4,19}$/.test(runId)) fail();
  if (!direct || direct.evidenceSchema !== 'TIGERIQ_REVENUE_PUBLIC_HTTP_LIVE_V1' ||
      direct.evidenceClass !== 'REAL_EXTERNAL_PUBLIC_HTTP_NOT_APIFY' ||
      direct.target !== TARGET || direct.verifiedSourceRevision !== sourceSha ||
      direct.auditStatus !== 'success' || direct.httpStatus !== 200 ||
      direct.pagesAudited !== 1 || !Number.isSafeInteger(direct.responseBytes) ||
      direct.responseBytes <= 0 ||
      direct.productReportFormat !== 'TIGERIQ_SEO_MARKDOWN_V1' ||
      direct.htmlDerived !== true || direct.externalPaidApiCostUsd !== 0 ||
      direct.apifyActorRan !== false || direct.apifyPlatformCostUsd !== null ||
      direct.platformBillingVerified !== false ||
      direct.paidRevenueVerified !== false || direct.fullWorkOrderAccepted !== false) fail();
  if (!ui || ui.evidenceSchema !== 'TIGERIQ_REVENUE_PUBLIC_UI_REAL_E2E_V1' ||
      ui.evidenceClass !== 'REAL_PUBLIC_HTTPS_THROUGH_LOCAL_UI_BACKEND_NOT_BROWSER_CLICK_NOT_APIFY' ||
      ui.sourceRevision !== sourceSha || ui.target !== TARGET ||
      ui.route !== 'POST /api/audit' || ui.loopbackBound !== true ||
      ui.auditStatus !== 'success' || ui.pagesAudited !== 1 ||
      ui.productReportFormat !== 'TIGERIQ_SEO_MARKDOWN_V1' ||
      ui.apifyActorRan !== false || ui.apifyPlatformCostUsd !== null ||
      ui.platformBillingVerified !== false || ui.externalPaidApiCostUsd !== 0 ||
      ui.productWorkOrderDone !== false || !HASH.test(ui.reportSha256 || '')) fail();
  const directMarkdown = validatedMarkdown(direct.productReportMarkdown);
  const uiMarkdown = validatedMarkdown(ui.productReportMarkdown);
  if (digest(uiMarkdown) !== ui.reportSha256) fail();
  const count = ui.issueCounts;
  if (!count || !['total','high','medium','low'].every(key=>
      Number.isSafeInteger(count[key]) && count[key] >= 0 && count[key] <= 4) ||
      count.total !== count.high + count.medium + count.low) fail();
  const runnerUrl = 'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/' + runId;
  const evidence = {
    schema: 'TIGERIQ_GH2293_OWNER_PUBLIC_RESULT_V1',
    workOrder: 'GH-2293',
    status: 'PUBLIC_DEMO_VERIFIED_PRIVATE_APIFY_NOT_VERIFIED',
    sourceSha,
    githubRun: runnerUrl,
    target: TARGET,
    directHttp: { status: 200, pagesAudited: 1, responseBytes: direct.responseBytes,
      reportSha256: digest(directMarkdown) },
    localUi: { route: 'POST /api/audit', loopbackOnly: true, pagesAudited: 1,
      reportSha256: ui.reportSha256, issues: {
        total: count.total, high: count.high, medium: count.medium, low: count.low } },
    cost: { externalPaidApiUsd: 0, apifyPlatformUsd: null, settledBillingVerified: false },
    gates: { privateActorAuthenticated: false, privateE2eExecuted: false,
      verifiedPaidRevenue: false, fullWorkOrderAccepted: false },
  };
  const ownerReport = [
    '# TigerIQ Revenue Lab — Website Audit | Kết quả demo công khai',
    '',
    '> **PHẠM VI ĐÃ KIỂM CHỨNG:** chỉ thử nghiệm HTTP/HTTPS thực trên example.com tại GitHub CI và API UI nội bộ 127.0.0.1. **Không phải** Apify Actor chạy riêng tư, hóa đơn, doanh thu hay phát hành sản phẩm.',
    '',
    '- Work Order: [GH-2293](https://github.com/newsdayads/tigeriq-ai-lab/issues/2293) — **CHƯA XONG TOÀN BỘ**.',
    '- Source SHA (GitHub CI exact-head): `' + sourceSha + '`.',
    '- Biên nhận workflow: ' + runnerUrl,
    '- Website thử nghiệm: ' + TARGET,
    '- HTTP trực tiếp: **200**, 1 trang, ' + direct.responseBytes + ' bytes.',
    '- Luồng giao diện backend cục bộ: **POST /api/audit**, 1 trang, loopback only; không phải test click browser.',
    '- SHA-256 báo cáo trực tiếp: `' + evidence.directHttp.reportSha256 + '`.',
    '- SHA-256 báo cáo qua UI: `' + evidence.localUi.reportSha256 + '`.',
    '- Đọc HTML công khai không dùng API trả phí: **0 USD**. Chi phí Apify thực: **CHƯA XÁC MINH**, không được ghi thành 0.',
    '- R04/R05/R06/R07/R08 và nghiệm thu cuối: **CHỜ dữ liệu Apify riêng tư, quyền hợp lệ, chi phí đã đối soát**.',
    '- Khuyến nghị: **ITERATE / CHƯA BÁN**, giữ cổng chi phí, bảo mật và quyền thực thi.',
    '',
    '## Báo cáo SEO thực tế qua HTTPS',
    '',
    directMarkdown,
    '',
    '## Giới hạn và hướng tiếp tục',
    '',
    'Báo cáo chỉ dựa trên HTML (title, meta description, H1), không phải xếp hạng Google, Lighthouse hay hiệu quả thương mại. Biên nhận Apify thực chỉ được bổ sung từ GET riêng tư đã cấp quyền và chứng từ thanh toán cuối có thẩm quyền. Không tạo lượt chạy trả phí để suy đoán số liệu.',
    '',
    'Đối chiếu bản xuất qua UI: xem tệp `ui-report.md` và giá trị SHA-256 trong `proof.json` đi cùng gói.',
    '',
  ].join('\n');
  return Object.freeze({ ownerReport, uiReport: uiMarkdown + '\n',
    proof: JSON.stringify(evidence, null, 2) + '\n' });
}
