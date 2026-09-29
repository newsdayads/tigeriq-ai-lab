import { createHash } from 'node:crypto';

export type GithubIssueLike = {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state?: string | null;
};

export type Nv04Role = 'DEEP_RESEARCH' | 'INDEPENDENT_REVIEW' | 'SECOND_OPINION';
export type Nv04Terminal = 'PASS' | 'CHANGES_REQUIRED' | 'BLOCKED';

export type Nv04Request = {
  jobId: string;
  inputRevision: string;
  issueNumber: number;
  issueUrl: string;
  resourceScope: string;
  role: Nv04Role;
  exactHead: string;
  exactInput: string;
  checklist: string;
  output: string;
  evidenceDestination: string;
  sourceSnapshot: string;
};

export type Nv04Result = {
  jobId: string;
  inputRevision: string;
  terminal: Nv04Terminal;
  findings: string;
  evidence: string;
  recommendation: string;
  raw: string;
};

export function parseControlFields(text: string) {
  const fields: Record<string, string> = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    fields[match[1].toUpperCase()] = match[2].trim();
  }
  return fields;
}

function truthy(value: string | undefined) {
  return /^(1|true|yes)$/i.test(String(value || '').trim());
}

export function issuePriority(issue: GithubIssueLike) {
  const fields = parseControlFields(issue.body || '');
  const raw = String(fields.PRIORITY || '').toUpperCase();
  if (/^P[0-5]$/.test(raw)) return raw;
  const title = issue.title.toUpperCase();
  const match = title.match(/\[(P[0-5])\]/);
  return match?.[1] || '';
}

export function resourceScope(issue: GithubIssueLike) {
  return parseControlFields(issue.body || '').RESOURCE_SCOPE || `ISSUE_${issue.number}`;
}

export function inputRevision(issue: GithubIssueLike) {
  const fields = parseControlFields(issue.body || '');
  if (fields.EXACT_HEAD) return fields.EXACT_HEAD;
  if (fields.TARGET_HEAD) return fields.TARGET_HEAD;
  if (fields.EXACT_INPUT) return fields.EXACT_INPUT;
  if (fields.INPUT_REVISION) return fields.INPUT_REVISION;
  return createHash('sha256')
    .update(`${issue.number}\n${issue.title}\n${issue.body || ''}`)
    .digest('hex');
}

function ownerAllowsP0(issue: GithubIssueLike) {
  const fields = parseControlFields(issue.body || '');
  return truthy(fields.OWNER_DIRECT) || truthy(fields.OWNER_CONTROLLED);
}

function isOpen(issue: GithubIssueLike) {
  return String(issue.state || 'open').toLowerCase() === 'open';
}

function issueTargetsWorker(issue: GithubIssueLike, workerId: 'NV03' | 'NV04') {
  const fields = parseControlFields(issue.body || '');
  return [fields.PRIMARY_EMPLOYEE, fields.TARGET_EMPLOYEE, fields.ASSIGNED_EXECUTOR]
    .some((value) => String(value || '').toUpperCase() === workerId);
}

export function eligibleNv03ReviewIssue(issue: GithubIssueLike) {
  if (!isOpen(issue)) return false;
  const fields = parseControlFields(issue.body || '');
  const priority = issuePriority(issue);
  if (priority === 'P0' && !ownerAllowsP0(issue)) return false;
  if (truthy(fields.MUTATION_ALLOWED) || /^code$/i.test(fields.CAPABILITY || '')) return false;
  if (truthy(fields.AUTONOMOUS_CODE) || fields.ALLOW_PATH_PREFIX) return false;
  const reviewSignal =
    truthy(fields.REVIEW_ONLY) ||
    /\b(REVIEW|QA|RÀ SOÁT|KIỂM TRA)\b/i.test(issue.title) ||
    issueTargetsWorker(issue, 'NV03');
  if (!reviewSignal) return false;
  if (fields.TARGET_EMPLOYEE && !issueTargetsWorker(issue, 'NV03')) return false;
  return true;
}

export function nv04RoleForIssue(issue: GithubIssueLike): Nv04Role | null {
  const fields = parseControlFields(issue.body || '');
  const explicit = String(fields.NV04_ROLE || fields.ROLE || '').toUpperCase();
  if (explicit === 'DEEP_RESEARCH' || explicit === 'INDEPENDENT_REVIEW' || explicit === 'SECOND_OPINION') {
    return explicit;
  }
  if (/\b(DEEP_RESEARCH|RESEARCH|NGHIÊN CỨU)\b/i.test(issue.title + '\n' + (issue.body || ''))) return 'DEEP_RESEARCH';
  if (/\b(SECOND_OPINION|PHẢN BIỆN|SECOND OPINION)\b/i.test(issue.title + '\n' + (issue.body || ''))) return 'SECOND_OPINION';
  if (/\b(REVIEW|RÀ SOÁT|KIỂM TRA)\b/i.test(issue.title)) return 'INDEPENDENT_REVIEW';
  if (issueTargetsWorker(issue, 'NV04')) return 'INDEPENDENT_REVIEW';
  return null;
}

export function eligibleNv04Issue(issue: GithubIssueLike) {
  if (!isOpen(issue)) return false;
  const fields = parseControlFields(issue.body || '');
  const priority = issuePriority(issue);
  if (priority === 'P0' && !ownerAllowsP0(issue)) return false;
  if (truthy(fields.MUTATION_ALLOWED) || /^code$/i.test(fields.CAPABILITY || '')) return false;
  if (truthy(fields.AUTONOMOUS_CODE) || fields.ALLOW_PATH_PREFIX) return false;
  if (fields.TARGET_EMPLOYEE && !issueTargetsWorker(issue, 'NV04')) return false;
  return nv04RoleForIssue(issue) !== null;
}

export function buildNv03ReviewPrompt(issue: GithubIssueLike) {
  const fields = parseControlFields(issue.body || '');
  const revision = inputRevision(issue);
  const targetHead = fields.TARGET_HEAD || fields.EXACT_HEAD || '';
  return [
    'LÀM — NO YAPPING.',
    'WORKER=NV03',
    'ROLE=INDEPENDENT_REVIEW_QA',
    `CURRENT_WORK_ORDER=#${issue.number}`,
    `SOURCE_ISSUE=${issue.html_url}`,
    `RESOURCE_SCOPE=${resourceScope(issue)}`,
    ...(targetHead ? [`TARGET_HEAD=${targetHead}`] : []),
    `INPUT_REVISION=${revision}`,
    'MUTATION_ALLOWED=false',
    'YÊU_CẦU=Đọc trực tiếp GitHub issue/PR/evidence liên quan; review độc lập; không sửa code, không merge, không deploy.',
    'OUTPUT=Ghi kết quả trực tiếp về GitHub issue nguồn với marker NV03_RESULT_BEGIN/NV03_RESULT_END, gồm INPUT_REVISION, RESULT=PASS|CHANGES_REQUIRED|BLOCKED, FINDINGS, EVIDENCE.',
  ].join('\n');
}

export function buildNv04Request(issue: GithubIssueLike): Nv04Request {
  const role = nv04RoleForIssue(issue);
  if (!role) throw new Error('NV04_ROLE_NOT_ELIGIBLE');
  const fields = parseControlFields(issue.body || '');
  const revision = inputRevision(issue);
  const jobId = `NV04-${issue.number}-${createHash('sha256').update(revision).digest('hex').slice(0, 12)}`;
  return {
    jobId,
    inputRevision: revision,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    resourceScope: resourceScope(issue),
    role,
    exactHead: fields.EXACT_HEAD || '',
    exactInput: fields.EXACT_INPUT || revision,
    checklist: fields.CHECKLIST || 'Đọc REQ, source snapshot và evidence; kiểm tra đúng phạm vi; không mutation.',
    output: fields.OUTPUT || 'KẾT LUẬN / PHÁT HIỆN / BẰNG CHỨNG / ĐỀ XUẤT',
    evidenceDestination: issue.html_url,
    sourceSnapshot: [`# ${issue.number} - ${issue.title}`, issue.body || ''].join('\n\n'),
  };
}

export function renderNv04Request(request: Nv04Request) {
  return [
    `JOB_ID=${request.jobId}`,
    `INPUT_REVISION=${request.inputRevision}`,
    `CURRENT_WORK_ORDER=#${request.issueNumber}`,
    `SOURCE_ISSUE=${request.issueUrl}`,
    `RESOURCE_SCOPE=${request.resourceScope}`,
    `NV04_ROLE=${request.role}`,
    `EXACT_HEAD=${request.exactHead}`,
    `EXACT_INPUT=${request.exactInput}`,
    `CHECKLIST=${request.checklist}`,
    `OUTPUT=${request.output}`,
    `EVIDENCE_DESTINATION=${request.evidenceDestination}`,
    'MUTATION_ALLOWED=false',
    '',
    '## SOURCE_SNAPSHOT',
    request.sourceSnapshot,
    '',
    '## RESULT CONTRACT',
    'Tạo RESULT tương ứng, bắt buộc giữ nguyên JOB_ID và INPUT_REVISION.',
    'RESULT phải là PASS, CHANGES_REQUIRED hoặc BLOCKED.',
  ].join('\n');
}

function sectionValue(raw: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const line = raw.match(new RegExp(`(?:^|\\n)${escaped}\\s*[:=]\\s*([^\\n\\r]+)`, 'i'));
    if (line?.[1]) return line[1].trim();
  }
  return '';
}

export function parseNv04Result(raw: string): Nv04Result {
  const fields = parseControlFields(raw);
  const jobId = fields.JOB_ID || sectionValue(raw, ['JOB_ID']);
  const inputRevision = fields.INPUT_REVISION || sectionValue(raw, ['INPUT_REVISION']);
  const resultText = fields.RESULT || sectionValue(raw, ['KẾT LUẬN', 'KET LUAN', 'RESULT']);
  let terminal: Nv04Terminal;
  if (/^(PASS|ĐẠT)$/i.test(resultText)) terminal = 'PASS';
  else if (/^(CHANGES_REQUIRED|CẦN SỬA|CAN SUA)$/i.test(resultText)) terminal = 'CHANGES_REQUIRED';
  else if (/^(BLOCKED|BỊ CHẶN|BI CHAN)$/i.test(resultText)) terminal = 'BLOCKED';
  else throw new Error('NV04_RESULT_TERMINAL_INVALID');
  if (!jobId) throw new Error('NV04_RESULT_JOB_ID_REQUIRED');
  if (!inputRevision) throw new Error('NV04_RESULT_INPUT_REVISION_REQUIRED');
  return {
    jobId,
    inputRevision,
    terminal,
    findings: sectionValue(raw, ['FINDINGS', 'PHÁT HIỆN', 'PHAT HIEN']),
    evidence: sectionValue(raw, ['EVIDENCE', 'BẰNG CHỨNG', 'BANG CHUNG']),
    recommendation: sectionValue(raw, ['RECOMMENDATION', 'ĐỀ XUẤT', 'DE XUAT']),
    raw,
  };
}

export function validateNv04Result(request: Nv04Request, result: Nv04Result) {
  if (result.jobId !== request.jobId) throw new Error('NV04_RESULT_JOB_ID_MISMATCH');
  if (result.inputRevision !== request.inputRevision) throw new Error('NV04_RESULT_STALE_INPUT_REVISION');
  return true;
}

export function renderNv04GithubComment(request: Nv04Request, result: Nv04Result) {
  validateNv04Result(request, result);
  return [
    'NV04_RESULT_BEGIN',
    `JOB_ID=${result.jobId}`,
    `INPUT_REVISION=${result.inputRevision}`,
    `RESULT=${result.terminal}`,
    `RESOURCE_SCOPE=${request.resourceScope}`,
    `FINDINGS=${result.findings || 'Không có phát hiện bổ sung.'}`,
    `EVIDENCE=${result.evidence || request.evidenceDestination}`,
    `RECOMMENDATION=${result.recommendation || 'Không mở rộng phạm vi.'}`,
    'NV04_RESULT_END',
  ].join('\n');
}
