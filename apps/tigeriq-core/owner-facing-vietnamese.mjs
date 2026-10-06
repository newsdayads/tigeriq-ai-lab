const STATUS_LABELS = Object.freeze({
  PASS: 'ĐẠT',
  DONE: 'HOÀN TẤT',
  COMPLETED: 'HOÀN TẤT',
  WORKING: 'ĐANG XỬ LÝ',
  RUNNING: 'ĐANG XỬ LÝ',
  READY: 'SẴN SÀNG',
  QUEUED: 'ĐANG CHỜ',
  WAITING: 'ĐANG CHỜ',
  WAIT_RESOURCE: 'ĐANG CHỜ',
  BLOCKED: 'BỊ CHẶN',
  FAILED: 'LỖI',
  ERROR: 'LỖI',
  EXTERNAL_WAIT: 'CHỜ BÊN NGOÀI',
  OWNER_GATE: 'CHỜ ANH SƠN DUYỆT',
  OWNER_APPROVAL_REQUIRED: 'CHỜ ANH SƠN DUYỆT',
  READY_FOR_OWNER_APPROVAL: 'ĐÃ ĐỦ ĐIỀU KIỆN — CHỜ ANH SƠN DUYỆT',
  REVIEW: 'RÀ SOÁT',
  VERIFY: 'XÁC MINH',
  OPEN: 'MỞ',
  PENDING: 'ĐANG CHỜ',
});

const OWNER_TERM_REPLACEMENTS = Object.freeze([
  [/\bfinal review\b/gi, 'rà soát cuối'],
  [/\bdeep cross-check\b/gi, 'kiểm tra chéo chuyên sâu'],
  [/\blive acceptance\b/gi, 'nghiệm thu trực tiếp'],
  [/\bcanary\b/gi, 'kiểm thử thực tế'],
  [/\bfallback\b/gi, 'phương án dự phòng'],
  [/\brouting\b/gi, 'định tuyến'],
]);

const STATUS_REPLACEMENTS = Object.freeze([
  [/\bREADY_FOR_OWNER_APPROVAL\b/g, STATUS_LABELS.READY_FOR_OWNER_APPROVAL],
  [/\bOWNER_GATE\b/g, STATUS_LABELS.OWNER_GATE],
  [/\bOWNER_APPROVAL_REQUIRED\b/g, STATUS_LABELS.OWNER_APPROVAL_REQUIRED],
  [/\bEXTERNAL_WAIT\b/g, STATUS_LABELS.EXTERNAL_WAIT],
  [/\bWAIT_RESOURCE\b/g, STATUS_LABELS.WAIT_RESOURCE],
  [/\bCOMPLETED\b/g, STATUS_LABELS.COMPLETED],
  [/\bWORKING\b/g, STATUS_LABELS.WORKING],
  [/\bRUNNING\b/g, STATUS_LABELS.RUNNING],
  [/\bWAITING\b/g, STATUS_LABELS.WAITING],
  [/\bBLOCKED\b/g, STATUS_LABELS.BLOCKED],
  [/\bFAILED\b/g, STATUS_LABELS.FAILED],
  [/\bERROR\b/g, STATUS_LABELS.ERROR],
  [/\bREADY\b/g, STATUS_LABELS.READY],
  [/\bQUEUED\b/g, STATUS_LABELS.QUEUED],
  [/\bPASS\b/g, STATUS_LABELS.PASS],
  [/\bDONE\b/g, STATUS_LABELS.DONE],
]);

export function ownerStatusLabel(value = '') {
  const key = String(value || '').trim().toUpperCase();
  return STATUS_LABELS[key] || String(value || '').trim();
}

export function localizeOwnerFacingText(value = '') {
  let text = String(value ?? '');
  for (const [pattern, replacement] of OWNER_TERM_REPLACEMENTS) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of STATUS_REPLACEMENTS) text = text.replace(pattern, replacement);
  return text;
}

export function ownerFacingWorkRow(row) {
  if (!row || typeof row !== 'object') return row;
  const statusCode = String(row.status || '').trim();
  const localized = {
    ...row,
    ...(statusCode ? { status: ownerStatusLabel(statusCode) } : {}),
  };
  if (typeof localized.displayState === 'string') localized.displayState = ownerStatusLabel(localized.displayState);
  if (typeof localized.waitReason === 'string') localized.waitReason = localizeOwnerFacingText(localized.waitReason);
  if (typeof localized.currentStep === 'string') localized.currentStep = localizeOwnerFacingText(localized.currentStep);
  if (typeof localized.detail === 'string') localized.detail = localizeOwnerFacingText(localized.detail);
  if (typeof localized.job === 'string') localized.job = localizeOwnerFacingText(localized.job);
  if (statusCode) localized.statusIcon = ownerStatusIcon(statusCode);
  const progress = verifiedOwnerProgress(localized.progress);
  if (progress) localized.progressPresentation = progress;
  else if ('progressPresentation' in localized) delete localized.progressPresentation;
  return localized;
}

export function containsBareEnglishOwnerStatus(value = '') {
  const text = String(value || '');
  return /\b(?:PASS|DONE|COMPLETED|WORKING|RUNNING|READY|QUEUED|WAITING|WAIT_RESOURCE|BLOCKED|FAILED|ERROR|EXTERNAL_WAIT|OWNER_GATE|OWNER_APPROVAL_REQUIRED|READY_FOR_OWNER_APPROVAL)\b/.test(text);
}


function stripOwnerTechnicalLiterals(value = '') {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ');
}

export function containsBareOwnerWorkReference(value = '') {
  const text = stripOwnerTechnicalLiterals(value);
  return /(^|[^\w/])#\d+\b(?!\s*-\s*\S)/m.test(text);
}

export function containsBareOwnerPrReference(value = '') {
  const text = stripOwnerTechnicalLiterals(value);
  return /\bPR\s+#\d+\b(?!\s*-\s*\S)/i.test(text);
}

export function containsOwnerFacingEnglishOperationalProse(value = '') {
  const text = stripOwnerTechnicalLiterals(value);
  return /\b(?:review|merge|runtime|deploy|deployment|blocker|pending|active|queued|ready|failed|pass|done|exact-head|save_not_durable)\b/i.test(text);
}

function hasOwnerWorkReference(value = '') {
  const text = stripOwnerTechnicalLiterals(value);
  return /(^|[^\w/])#\d+\b|\bPR\s+#\d+\b/im.test(text);
}

export const OWNER_STATUS_LABELS = STATUS_LABELS;


export const OWNER_PRESENTATION_ICONS = Object.freeze({
  COMPLETED: '✅',
  WORKING: '⚙️',
  WAITING: '⏳',
  ATTENTION: '⚠️',
  OWNER: '🔒',
  IDEA: '💡',
  KEY: '📌',
  NEXT: '➡️',
});

export const OWNER_ALLOWED_ICONS = Object.freeze(Object.values(OWNER_PRESENTATION_ICONS));

export function containsUnapprovedOwnerIcon(value = '') {
  let text = String(value ?? '');
  for (const icon of OWNER_ALLOWED_ICONS) text = text.split(icon).join('');
  return /\p{Extended_Pictographic}/u.test(text);
}

const VI_STATUS_ICON = Object.freeze({
  'ĐẠT': OWNER_PRESENTATION_ICONS.COMPLETED,
  'HOÀN TẤT': OWNER_PRESENTATION_ICONS.COMPLETED,
  'ĐANG XỬ LÝ': OWNER_PRESENTATION_ICONS.WORKING,
  'SẴN SÀNG': OWNER_PRESENTATION_ICONS.WAITING,
  'ĐANG CHỜ': OWNER_PRESENTATION_ICONS.WAITING,
  'CHỜ BÊN NGOÀI': OWNER_PRESENTATION_ICONS.WAITING,
  'BỊ CHẶN': OWNER_PRESENTATION_ICONS.ATTENTION,
  'LỖI': OWNER_PRESENTATION_ICONS.ATTENTION,
  'CHỜ ANH SƠN DUYỆT': OWNER_PRESENTATION_ICONS.OWNER,
  'ĐÃ ĐỦ ĐIỀU KIỆN — CHỜ ANH SƠN DUYỆT': OWNER_PRESENTATION_ICONS.OWNER,
  'RÀ SOÁT': OWNER_PRESENTATION_ICONS.WORKING,
  'XÁC MINH': OWNER_PRESENTATION_ICONS.WORKING,
  'MỞ': OWNER_PRESENTATION_ICONS.WAITING,
  'ĐANG LÀM': OWNER_PRESENTATION_ICONS.WORKING,
  'CHỜ': OWNER_PRESENTATION_ICONS.WAITING,
  'RẢNH': OWNER_PRESENTATION_ICONS.WAITING,
  'TẠM NGƯNG': OWNER_PRESENTATION_ICONS.ATTENTION,
  'CHƯA RÕ': OWNER_PRESENTATION_ICONS.ATTENTION,
  'CHƯA XÁC MINH': OWNER_PRESENTATION_ICONS.ATTENTION,
  'HOÀN THÀNH': OWNER_PRESENTATION_ICONS.COMPLETED,
  'CHỜ ANH SƠN': OWNER_PRESENTATION_ICONS.OWNER,
  'HỆ THỐNG': OWNER_PRESENTATION_ICONS.KEY,
  'CẦN XỬ LÝ': OWNER_PRESENTATION_ICONS.ATTENTION,
});

export const OWNER_SURFACE_REGISTRY = Object.freeze([
  'DIRECT_CHAT_NEW_CHAT',
  'CORE_GITHUB_COMMENTS',
  'NV_API_OUTPUT',
  'UI_WORKER_OUTPUT',
  'CODING_LANE_SUMMARY',
  'QUEUE_CHECKPOINT_HANDOFF_REPORT',
  'TIGERIQ_LIVE_WEB_CONTROL',
  'AUTOMATION_NOTICE',
]);

export function ownerStatusIcon(value = '') {
  const label = ownerStatusLabel(value);
  return VI_STATUS_ICON[label] || OWNER_PRESENTATION_ICONS.KEY;
}

export function verifiedOwnerProgress(input = null) {
  if (!input || typeof input !== 'object') return null;
  if (input.stale === true || input.conflicting === true || input.verified !== true) return null;
  const passed = Number(input.passed);
  const total = Number(input.total);
  if (!Number.isInteger(passed) || !Number.isInteger(total) || total <= 0 || passed < 0 || passed > total) return null;
  const percent = Math.round((passed / total) * 100);
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return {
    passed,
    total,
    percent,
    bar: '█'.repeat(filled) + '░'.repeat(10 - filled),
    text: `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${percent}%`,
    verified: true,
  };
}

export function ownerFacingPresentation({ status = '', result = '', blocker = '', nextAction = '', progress = null } = {}) {
  const progressView = verifiedOwnerProgress(progress);
  const label = ownerStatusLabel(status);
  return {
    status: label,
    icon: ownerStatusIcon(status),
    progress: progressView,
    result: localizeOwnerFacingText(result),
    blocker: localizeOwnerFacingText(blocker),
    nextAction: localizeOwnerFacingText(nextAction),
    order: ['KẾT QUẢ', 'VƯỚNG', 'BƯỚC TIẾP THEO'],
  };
}

export function validateOwnerFacingOutput({ text = '', progress = null, evidenceFresh = true, canonicalRefsResolved = null } = {}) {
  const defects = [];
  const value = String(text || '');
  const hasPercent = value.includes('%') && /\d/.test(value);
  if (containsBareEnglishOwnerStatus(value)) defects.push('BARE_ENGLISH_STATUS');
  if (containsOwnerFacingEnglishOperationalProse(value)) defects.push('ENGLISH_OPERATIONAL_PROSE');
  if (containsBareOwnerWorkReference(value)) defects.push('BARE_WORK_REFERENCE');
  if (containsBareOwnerPrReference(value)) defects.push('BARE_PR_REFERENCE');
  if (containsUnapprovedOwnerIcon(value)) defects.push('UNAPPROVED_ICON');
  if (hasPercent && !verifiedOwnerProgress(progress)) defects.push('UNVERIFIED_PROGRESS_PERCENT');
  if (evidenceFresh === false && hasPercent) defects.push('STALE_PROGRESS_VISIBLE');
  if (canonicalRefsResolved === false || (hasOwnerWorkReference(value) && canonicalRefsResolved !== true)) defects.push('UNRESOLVED_WORK_REFERENCE');
  return { ok: defects.length === 0, defects };
}
