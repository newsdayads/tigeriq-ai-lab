// BCCT V4 output contract — pure, fail-closed validator for TigerIQ-owned renderers.
// It does not control the native ChatGPT renderer or fetch private RDC accounts.
export const BCCT_SECTIONS = Object.freeze([
  'Tổng tiến độ','Hạng mục chính','P0 bị chặn/cần chú ý',
  'Đang xử lý','Nhân sự AI','Mốc kế tiếp',
]);
const FORBIDDEN_STATUS_EMOJI = /[✅⚙️⏳⚠️🔒💡📌➡️]/u;
const UNKNOWN = 'CHƯA XÁC MINH';
const STATES = new Set(['HOÀN TẤT','ĐANG XỬ LÝ','CHỜ','BỊ CHẶN','CHƯA XÁC MINH']);

export function validateBcctV4(report) {
  const errors = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) return {ok:false,errors:['REPORT_INVALID']};
  const sections = report.sections;
  if (!Array.isArray(sections) || sections.length !== 6 ||
      sections.some((s,i)=>!s || s.title !== BCCT_SECTIONS[i] || typeof s.text !== 'string' || !s.text.trim())) {
    errors.push('SIX_ORDERED_SECTIONS_REQUIRED');
  }
  if (typeof report.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(report.generatedAt) ||
      Number.isNaN(Date.parse(report.generatedAt))) errors.push('VERIFIED_TIMESTAMP_REQUIRED');
  if (typeof report.sourceUrl !== 'string' || !/^https:\/\/(github\.com|api\.github\.com)\//.test(report.sourceUrl))
    errors.push('SOURCE_URL_REQUIRED');
  if (!report.dataVerified && report.completionPercent != null) errors.push('UNVERIFIED_PERCENT');
  if (report.completionPercent != null && (!Number.isFinite(report.completionPercent) || report.completionPercent < 0 ||
       report.completionPercent > 100 || !Number.isInteger(report.completedCount) ||
       !Number.isInteger(report.totalCount) || report.totalCount < 1 ||
       report.completedCount / report.totalCount * 100 !== report.completionPercent)) errors.push('PERCENT_DENOMINATOR_REQUIRED');
  if (typeof report.status !== 'string' || !STATES.has(report.status)) errors.push('STATUS_INVALID');
  const content = sections?.map(s=>s?.text || '').join(' ') || '';
  if (FORBIDDEN_STATUS_EMOJI.test(content)) errors.push('LEGACY_STATUS_EMOJI');
  if (!report.filters || !['interactive','text-fallback'].includes(report.filters.mode) ||
      !Array.isArray(report.filters.options) ||
      !['Tất cả','Chưa xong','P0','Đã xong'].every(x=>report.filters.options.includes(x))) errors.push('FILTER_REQUIRED');
  if (report.filters?.mode === 'interactive' && typeof report.filters.onSelect !== 'function') errors.push('FILTER_ACTION_REQUIRED');
  if (!Array.isArray(report.jobs) || report.jobs.some(j=>!j || !Number.isInteger(j.issue) ||
      !j.title?.trim() || !/^https:\/\/github\.com\//.test(j.url || ''))) errors.push('GROUNDED_JOB_LINKS_REQUIRED');
  if (!Array.isArray(report.rdc) || report.rdc.length !== 5 ||
      report.rdc.some(a=>!a || typeof a.account !== 'string' || !a.account ||
        !['TRỰC TUYẾN','NGOẠI TUYẾN',UNKNOWN].includes(a.pc01) ||
        (a.remainingPct !== null && (!Number.isFinite(a.remainingPct) || a.remainingPct < 0 || a.remainingPct > 100)) ||
        (a.pc01 === UNKNOWN && a.remainingPct !== null))) errors.push('FIVE_RDC_ACCOUNTS_OR_UNKNOWN_REQUIRED');
  if (report.rdc?.some(a=>a.remainingPct !== null) &&
      !report.rdcCheckedAt) errors.push('RDC_CHECKED_AT_REQUIRED');
  if (report.rdcPreferredAccount != null) {
    const candidates = report.rdc?.filter(a=>a.pc01 === 'TRỰC TUYẾN' && a.remainingPct > 0) || [];
    const max = Math.max(...candidates.map(a=>a.remainingPct));
    if (!candidates.some(a=>a.account === report.rdcPreferredAccount && a.remainingPct === max))
      errors.push('RDC_PREFERRED_UNVERIFIED');
  }
  return {ok:errors.length === 0,errors};
}

// Caller must validate before emitting; invalid output is never published as a passed BCCT.
export function publishBcctV4(report, emit) {
  const result = validateBcctV4(report);
  if (!result.ok) return {published:false,errors:result.errors};
  emit(report);
  return {published:true,errors:[]};
}
