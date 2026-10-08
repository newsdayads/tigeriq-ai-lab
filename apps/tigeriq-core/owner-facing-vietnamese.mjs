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

const OWNER_PRESERVED_PROPER_NAMES = Object.freeze([
  /\bTigerIQ Live\b/gi,
]);

function protectOwnerProperNames(value = '') {
  const preserved = [];
  let text = String(value ?? '');
  for (const pattern of OWNER_PRESERVED_PROPER_NAMES) {
    text = text.replace(pattern, (match) => {
      const token = `@@OWNER_PROPER_${preserved.length}@@`;
      preserved.push(match);
      return token;
    });
  }
  return { text, preserved };
}

function restoreOwnerProperNames(value = '', preserved = []) {
  let text = String(value ?? '');
  preserved.forEach((original, index) => {
    text = text.replace(`@@OWNER_PROPER_${index}@@`, original);
  });
  return text;
}

const OWNER_PHRASE_REPLACEMENTS = Object.freeze([
  [/\bEXPLICIT_EXECUTION_DISABLED\b/g, 'Tạm dừng thực thi theo nguồn chuẩn'],
  [/\bAUTO_QUEUE_EXCLUDED\b/g, 'Không thuộc hàng đợi tự động'],
  [/\bHARD_GATE_SAFETY_FLAGS_INCOMPLETE\b/g, 'Thiếu điều kiện an toàn bắt buộc'],
  [/\bOWNER_OR_HOLD_GATE\b/g, 'Chờ anh Sơn hoặc điều kiện giữ'],
  [/\bP0_OR_INVALID_PRIORITY\b/g, 'P0 hoặc mức ưu tiên không hợp lệ'],
  [/\bDEPENDENCY_BLOCKED\b/g, 'Đang chờ phụ thuộc'],
  [/\bMUTATION_OWNER_CONFLICT\b/g, 'Xung đột quyền ghi'],
  [/\bNO_ELIGIBLE_RESOURCE\b/g, 'Chưa có tài nguyên phù hợp'],
  [/\bcredential material\b/gi, 'thông tin xác thực'],
  [/\bmust become available\b/gi, 'phải sẵn sàng'],
  [/\bWhen existing\b/gi, 'Khi'],
  [/\bwithout new\/changed\b/gi, 'mà không tạo hoặc thay đổi'],
  [/\bfast-forward-only sync\b/gi, 'chỉ đồng bộ tiến tới'],
  [/\bsync exact main\b/gi, 'đồng bộ chính xác nhánh main'],
  [/\bthen set only nonsecret\b/gi, 'sau đó chỉ thiết lập giá trị không bí mật'],
  [/\bset nonsecret\b/gi, 'thiết lập cấu hình không bí mật'],
  [/\brestart News runtime\b/gi, 'khởi động lại môi trường News'],
  [/\brun soak\/quality gates\b/gi, 'chạy kiểm tra bền và cổng chất lượng'],
  [/\bDo not wait for Owner\b/gi, 'Không chờ anh Sơn'],
  [/\bDiagnose actual browser request\b/gi, 'Chẩn đoán yêu cầu trình duyệt thực tế'],
  [/\bcreate admin\b/gi, 'tạo quản trị viên'],
  [/\brun full sandbox E2E\b/gi, 'chạy E2E sandbox đầy đủ'],
  [/\bverify restart\/duplicate behavior\b/gi, 'xác minh hành vi khởi động lại và chống trùng'],
  [/\bbenchmark\b/gi, 'đánh giá chuẩn'],
  [/\bPaperclip runtime is healthy, but authenticated deployment has no usable admin session because first-admin credentials have not yet been set by Owner in browser\.?/gi,
    'Môi trường Paperclip đang ổn, nhưng bản triển khai có xác thực chưa có phiên quản trị dùng được vì anh Sơn chưa thiết lập thông tin xác thực quản trị đầu tiên trong trình duyệt'],
  [/\bResume only when\b/gi, 'Chỉ tiếp tục khi'],
  [/\ba non-materializing lifecycle integration harness exists\b/gi, 'có bộ kiểm thử tích hợp vòng đời không phát sinh tác vụ'],
  [/\bOwner changes the no-new-work constraint\b/gi, 'anh Sơn thay đổi ràng buộc không tạo việc mới'],
  [/\bdo not repeat the same synthetic preflight\b/gi, 'không lặp lại cùng tiền kiểm mô phỏng'],
  [/\bTrack\b/gi, 'Theo dõi'],
  [/\bimplement>test>independent review>merge>PC01 runtime>publish>live verify\b/gi,
    'triển khai>kiểm thử>rà soát độc lập>hợp nhất>môi trường PC01>xuất bản>xác minh thực tế'],
  [/\breconcile\b/gi, 'đối soát'],
  [/\bverified acceptance\b/gi, 'nghiệm thu đã xác minh'],
  [/\bprivate Actor\b/gi, 'Actor riêng'],
  [/\binject scoped\b/gi, 'nạp theo phạm vi'],
  [/\bpreflight\b/gi, 'tiền kiểm'],
  [/\bsign current CI artifact\b/gi, 'ký gói CI hiện hành'],
  [/\bcurrent CI artifact\b/gi, 'gói CI hiện hành'],
  [/\bruntime apply\b/gi, 'áp dụng môi trường chạy'],
  [/\bpublish manifest\b/gi, 'xuất bản manifest'],
  [/\bS10 acceptance\b/gi, 'nghiệm thu S10'],
  [/\bsystem precheck\b/gi, 'tiền kiểm hệ thống'],
  [/\brequest Owner secret injection only if required\b/gi, 'chỉ yêu cầu anh Sơn nạp bí mật nếu cần'],
  [/\bone private E2E\b/gi, 'một E2E riêng'],
  [/\bmeasure cost\b/gi, 'đo chi phí'],
  [/\bKEEP\/ITERATE\/KILL\b/gi, 'GIỮ/LẶP CẢI TIẾN/DỪNG'],
  [/\bquality gates\b/gi, 'cổng chất lượng'],
  [/\bverify live\b/gi, 'xác minh thực tế'],
  [/\bprivate preflight\b/gi, 'tiền kiểm riêng'],
  [/\bprivate E2E\b/gi, 'E2E riêng'],
  [/\bPIN_PASS_AND_MERGE\b/g, 'PIN ĐẠT VÀ HỢP NHẤT'],
  [/\bOwner\b/g, 'anh Sơn'],
  [/\bthen\b/gi, 'sau đó'],
  [/\bthrough\b/gi, 'qua'],
  [/\bclose\b/gi, 'đóng'],
  [/\bbecomes available\b/gi, 'sẵn sàng'],
  [/\bbounded\b/gi, 'có giới hạn'],
  [/\bconfig\b/gi, 'cấu hình'],
]);

const OWNER_TERM_REPLACEMENTS = Object.freeze([
  [/\bDeep Agents\/LangGraph\b/gi, 'Deep Agents/LangGraph (khung điều phối tác nhân)'],
  [/\bCore NV API\b/gi, 'Core NV API (giao diện AI trung tâm)'],
  [/\bnormal npm resolution\b/gi, 'phân giải npm thông thường'],
  [/\bfresh exact-head\b/gi, 'kiểm tra đúng đầu nhánh mới'],
  [/\bexact-head\b/gi, 'đúng đầu nhánh'],
  [/\bQueue Hygiene\b/gi, 'Queue Hygiene (kiểm tra vệ sinh hàng đợi)'],
  [/\bsmoke test\b/gi, 'kiểm thử nhanh'],
  [/\bmain readback\b/gi, 'đọc lại main'],
  [/\bexisting PR\b/gi, 'PR hiện có'],
  [/\bonly after\b/gi, 'chỉ sau khi'],
  [/\blockfile\b/gi, 'tệp khóa phụ thuộc'],
  [/\bisolated\b/gi, 'cô lập'],
  [/\bfoundation\b/gi, 'nền tảng'],
  [/\bprivate[- ]repo\b/gi, 'kho mã riêng'],
  [/\bcheckpoint\b/gi, 'điểm lưu trạng thái'],
  [/\bshadow\b/gi, 'chạy song song'],
  [/\bsoak\b/gi, 'chạy bền'],
  [/\breadiness\b/gi, 'mức sẵn sàng'],
  [/\brepairs?\b/gi, 'sửa lỗi'],
  [/\bauth\b/gi, 'xác thực'],
  [/\bfinal review\b/gi, 'rà soát cuối'],
  [/\bdeep cross-check\b/gi, 'kiểm tra chéo chuyên sâu'],
  [/\blive acceptance\b/gi, 'nghiệm thu trực tiếp'],
  [/\bcanary\b/gi, 'kiểm thử thực tế'],
  [/\bfallback\b/gi, 'phương án dự phòng'],
  [/\brouting\b/gi, 'định tuyến'],
  [/\bruntime\b/gi, 'môi trường chạy'],
  [/\bhealth\b/gi, 'tình trạng'],
  [/\breview\b/gi, 'rà soát'],
  [/\bmerge\b/gi, 'hợp nhất'],
  [/\bdeploy(?:ment)?\b/gi, 'triển khai'],
  [/\brelease\b/gi, 'phát hành'],
  [/\bpublish\b/gi, 'xuất bản'],
  [/\bblocker\b/gi, 'điểm bị chặn'],
  [/\bpending\b/gi, 'chờ'],
  [/\bactive\b/gi, 'đang xử lý'],
  [/\bqueued\b/gi, 'đang chờ'],
  [/\bcredential(?:s)?\b/gi, 'thông tin xác thực'],
  [/\bsecurity\b/gi, 'bảo mật'],
  [/\bbrowser\b/gi, 'trình duyệt'],
  [/\breboot\b/gi, 'khởi động lại'],
  [/\bworkflow\b/gi, 'quy trình'],
  [/\bevidence\b/gi, 'bằng chứng'],
  [/\bprompt\b/gi, 'câu lệnh giao việc'],
  [/\bproduction\b/gi, 'môi trường vận hành chính thức'],
  [/\bcode\b/gi, 'mã nguồn'],
  [/\bself[- ]install\b/gi, 'tự cài đặt'],
  [/\blive\b/gi, 'thực tế'],
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
  const { text: protectedText, preserved } = protectOwnerProperNames(value);
  let text = protectedText;
  for (const [pattern, replacement] of OWNER_PHRASE_REPLACEMENTS) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of OWNER_TERM_REPLACEMENTS) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of STATUS_REPLACEMENTS) text = text.replace(pattern, replacement);
  return restoreOwnerProperNames(text, preserved);
}

export function ownerFacingWorkRow(row) {
  if (!row || typeof row !== 'object') return row;
  const statusCode = String(row.status || '').trim();
  const localized = {
    ...row,
    ...(statusCode ? { status: ownerStatusLabel(statusCode) } : {}),
  };
  if (typeof localized.displayState === 'string') localized.displayState = ownerStatusLabel(localized.displayState);
  for (const field of ['title','waitReason','currentStep','latestCompletedStep','nextStep','nextAction','blocker','detail','job']) {
    if (typeof localized[field] === 'string') localized[field] = localizeOwnerFacingText(localized[field]);
  }
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
  const { text } = protectOwnerProperNames(value);
  return text
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

const OWNER_ENGLISH_OPERATIONAL_RE = /\b(?:review|merge|runtime|deploy|deployment|blocker|pending|active|queued|ready|failed|pass|done|exact-head|save_not_durable|health|release|publish|credential|credentials|security|browser|reboot|workflow|evidence|prompt|production|code|canary|fallback|routing|live|self[- ]install|lockfile|isolated|foundation|readback|resolution|repairs?|fresh|sync|nonsecret|config|restart|quality|gate|diagnose|request|admin|benchmark|authenticated|session|preflight|inject|scoped|acceptance|artifact|manifest|reconcile)\b|\bsmoke\s+test\b|\bonly\s+after\b|\bmust\s+become\s+available\b|\bdo\s+not\s+wait\b/gi;
const VIETNAMESE_EXPLANATION_RE = /[ăâđêôơưàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;

export function containsOwnerFacingEnglishOperationalProse(value = '') {
  const text = stripOwnerTechnicalLiterals(value);
  for (const match of text.matchAll(OWNER_ENGLISH_OPERATIONAL_RE)) {
    const tail = text.slice(Number(match.index || 0) + match[0].length);
    const explanation = tail.match(/^\s*\(([^)\n]{2,120})\)/);
    if (!explanation || !VIETNAMESE_EXPLANATION_RE.test(explanation[1])) return true;
  }
  return false;
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
