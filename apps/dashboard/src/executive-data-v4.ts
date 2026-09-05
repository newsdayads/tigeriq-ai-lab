import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ServerTelemetry } from './server.js';

const execFileAsync = promisify(execFile);

type Issue = { number?: number; title?: string; body?: string | null; state?: string; updated_at?: string };
type Comment = { body?: string | null; created_at?: string | null; updated_at?: string | null };
type EmployeeCode = 'NV01' | 'NV02' | 'NV03' | 'NV04';
type Tone = 'active' | 'waiting' | 'blocked' | 'done' | 'paused' | 'unknown';

type Lane = { issue: Issue; comments: Comment[] };

export type ExecutiveWorkV4 = {
  number: number | null;
  title: string;
  ownerCode: EmployeeCode | null;
  owner: string;
  progressPercent: number | null;
  progressLabel: string;
  status: string;
  tone: Tone;
  next: string;
  updated: string;
};

export type ExecutivePersonV4 = {
  key: 'VY' | EmployeeCode;
  initials: string;
  name: string;
  role: string;
  status: string;
  tone: Tone;
  current: string;
  activeCount: number;
};

export type ExecutiveSystemV4 = {
  key: string;
  name: string;
  status: string;
  tone: Tone;
  note: string;
};

export type ExecutiveDashboardV4 = {
  generatedAt: string;
  works: ExecutiveWorkV4[];
  people: ExecutivePersonV4[];
  systems: ExecutiveSystemV4[];
  activeCount: number;
  waitingCount: number;
  blockedCount: number;
  doneCount: number;
  pausedCount: number;
  progressAverage: number | null;
  ownerActionRequired: boolean;
  ownerActionText: string;
};

function compact(value: string, max = 150): string {
  const out = String(value || '').replace(/\s+/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

function section(bodyText: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = bodyText.match(new RegExp(`(?:^|\\n)##\\s+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'));
  return (match?.[1] ?? '').trim();
}

function commentTime(comment: Comment): number {
  const value = Date.parse(comment.updated_at || comment.created_at || '1970-01-01');
  return Number.isFinite(value) ? value : 0;
}

async function ghJson<T>(repo: string, endpoint: string): Promise<T> {
  const { stdout } = await execFileAsync('gh', ['api', `repos/${repo}/${endpoint}`], {
    timeout: 15_000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout || '{}') as T;
}

function employeeCode(value: string): EmployeeCode | null {
  const exact = value.match(/\b(NV0[1-4])\b/i)?.[1]?.toUpperCase() as EmployeeCode | undefined;
  if (exact) return exact;
  if (/Minh\s*\(/i.test(value)) return 'NV01';
  if (/Khoa\s*\(/i.test(value)) return 'NV02';
  if (/Huy\s*\(/i.test(value)) return 'NV03';
  if (/Khải\s*\(/i.test(value)) return 'NV04';
  return null;
}

function ownerCode(issue: Issue, comments: Comment[]): EmployeeCode | null {
  for (const comment of [...comments].sort((a, b) => commentTime(b) - commentTime(a))) {
    const text = String(comment.body ?? '');
    const field = text.match(/(?:^|\n)(?:employee_id|owner|claimed_by|active_owner|assigned_to|new_owner)=([^\n]+)/i)?.[1];
    const code = field ? employeeCode(field) : null;
    if (code) return code;
  }
  const title = employeeCode(String(issue.title ?? ''));
  if (title) return title;
  const responsible = employeeCode(section(String(issue.body ?? ''), 'Người phụ trách').slice(0, 500));
  if (responsible) return responsible;
  return employeeCode(String(issue.body ?? '').match(/(?:^|\n)(?:owner|employee_id|assigned_to)=([^\n]+)/i)?.[1] ?? '');
}

function ownerName(code: EmployeeCode | null): string {
  if (code === 'NV01') return 'Minh (NV01)';
  if (code === 'NV02') return 'Khoa (NV02)';
  if (code === 'NV03') return 'Huy (NV03)';
  if (code === 'NV04') return 'Khải (NV04)';
  return 'Chưa xác minh';
}

function lifecycle(comments: Comment[], issue: Issue): { status: string; tone: Tone; current: string } {
  if (issue.state === 'closed') return { status: 'Hoàn tất', tone: 'done', current: 'Issue đã đóng' };
  for (const comment of [...comments].sort((a, b) => commentTime(b) - commentTime(a))) {
    const text = String(comment.body ?? '');
    const state = [...text.matchAll(/(?:^|\n)state=([^\n]+)/gi)].at(-1)?.[1]?.trim();
    const current = compact(state || text.split(/\r?\n/).find((line) => line.trim()) || 'Có cập nhật', 120);
    if (state && /HOÀN_TẤT|HOÀN TẤT|DONE|COMPLETED/i.test(state)) return { status: 'Hoàn tất', tone: 'done', current };
    if (state && /LỖI|FAILED|BỊ_CHẶN|BỊ CHẶN|BLOCKED/i.test(state)) return { status: 'Vướng mắc', tone: 'blocked', current };
    if (state && /TẠM_NGƯNG|TẠM NGƯNG|PAUSED/i.test(state)) return { status: 'Tạm ngưng', tone: 'paused', current };
    if (state && /CHỜ|WAIT|PENDING/i.test(state)) return { status: 'Chờ xử lý', tone: 'waiting', current };
    if (state && /ĐANG_XỬ_LÝ|ĐANG XỬ LÝ|IN_PROGRESS|RUNNING/i.test(state)) return { status: 'Đang làm', tone: 'active', current };
    if (/TIGERIQ_(?:JOB|COMMAND|PC01)_FAILED/i.test(text)) return { status: 'Vướng mắc', tone: 'blocked', current };
    if (/TIGERIQ_(?:JOB|COMMAND|PC01)_(?:DONE|RESULT)/i.test(text)) return { status: 'Hoàn tất', tone: 'done', current };
    if (/TIGERIQ_(?:JOB|COMMAND|PC01)_CLAIMED|heartbeat/i.test(text)) return { status: 'Đang làm', tone: 'active', current };
  }
  return { status: 'Chờ xử lý', tone: 'waiting', current: 'Chưa có lifecycle mới' };
}

function progressPercent(issue: Issue, comments: Comment[]): number | null {
  const sources = [...comments].sort((a, b) => commentTime(b) - commentTime(a)).map((row) => String(row.body ?? ''));
  sources.push(String(issue.body ?? ''));
  for (const text of sources) {
    const patterns = [
      /(?:^|\n)(?:progress|progress_percent|tiến_độ|tien_do)\s*[=:]\s*(\d{1,3})%?/i,
      /(?:tiến độ|progress)\s*[:=]?\s*(\d{1,3})%/i,
    ];
    for (const pattern of patterns) {
      const value = Number(text.match(pattern)?.[1]);
      if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
    }
  }
  return null;
}

function nextMilestone(issue: Issue): string {
  const body = String(issue.body ?? '');
  const acceptance = section(body, 'Điều kiện ĐẠT').split(/\r?\n/).map((line) => line.replace(/^[-*\d.\s]+/, '').trim()).find(Boolean);
  const next = section(body, 'Mốc kế tiếp').split(/\r?\n/).map((line) => line.replace(/^[-*\d.\s]+/, '').trim()).find(Boolean);
  return compact(next || acceptance || 'Theo acceptance hiện hành', 92);
}

function resolvePriorityIssueNumber(central: Issue | null, comments: Comment[]): number | null {
  for (const comment of [...comments].sort((a, b) => commentTime(b) - commentTime(a))) {
    const text = String(comment.body ?? '');
    const current = text.match(/ƯU TIÊN HIỆN HÀNH\s*:?\s*[\s\S]{0,900}?#(\d+)/i);
    if (current) return Number(current[1]);
    const absolute = text.match(/P0_ABSOLUTE[^\n#]{0,160}#(\d+)|#(\d+)[^\n]{0,160}P0_ABSOLUTE/i);
    if (absolute) return Number(absolute[1] || absolute[2]);
  }
  const block = section(String(central?.body ?? ''), 'Ưu tiên hiện hành');
  const found = block.match(/#(\d+)/) || String(central?.body ?? '').match(/##\s*P0 hiện hành[^\n]*#(\d+)/i);
  return found ? Number(found[1]) : null;
}

function resolveLaneNumbers(central: Issue | null, currentNumber: number | null): number[] {
  const block = section(String(central?.body ?? ''), 'Ưu tiên hiện hành');
  const numbers: number[] = [];
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\.\s+.*?#(\d+)/);
    if (match) numbers.push(Number(match[1]));
  }
  if (currentNumber) numbers.unshift(currentNumber);
  return [...new Set(numbers.filter((value) => Number.isInteger(value) && value > 0))].slice(0, 5);
}

function nv03Paused(registry: Issue | null, central: Issue | null): boolean {
  const registryText = String(registry?.body ?? '');
  const centralText = String(central?.body ?? '');
  return /NV03[^\n]*active=false[^\n]*TẠM NGƯNG/i.test(registryText)
    || /`3`[^\n]*false[^\n]*TẠM NGƯNG/i.test(registryText)
    || /Huy[^\n]*NV03[^\n]*TẠM NGƯNG/i.test(centralText)
    || /Command `3`[^\n]*enabled=false/i.test(`${registryText}\n${centralText}`);
}

function ownerAction(comments: Comment[]): { required: boolean; text: string } {
  for (const row of [...comments].sort((a, b) => commentTime(b) - commentTime(a))) {
    const text = String(row.body ?? '');
    if (!/OWNER_ACTION_REQUIRED=true|CẦN ANH SƠN\s*:/i.test(text)) continue;
    const line = text.split(/\r?\n/).find((value) => /CẦN ANH SƠN|OWNER_ACTION_REQUIRED/i.test(value)) ?? 'Có hạng mục cần anh Sơn xử lý';
    return { required: true, text: compact(line.replace(/^.*?CẦN ANH SƠN\s*:\s*/i, ''), 130) };
  }
  return { required: false, text: 'Không có việc cần anh Sơn' };
}

function systemRows(telemetry: ServerTelemetry): ExecutiveSystemV4[] {
  const cpu = telemetry.cpu?.utilizationPercent;
  const ram = telemetry.memory?.utilizationPercent;
  const serverNote = telemetry.available
    ? [typeof cpu === 'number' ? `CPU ${Math.round(cpu)}%` : null, typeof ram === 'number' ? `RAM ${Math.round(ram)}%` : null, telemetry.tailscale?.ip ? `Tailscale ${telemetry.tailscale.ip}` : null].filter(Boolean).join(' · ') || 'Máy chủ có phản hồi'
    : 'Chưa có telemetry máy chủ';
  const controlOnline = telemetry.controller?.online === true;
  const workerOnline = telemetry.worker?.online === true;
  return [
    { key: 'pc01', name: 'PC01 Server', status: telemetry.available ? 'Hoạt động' : 'Chưa xác minh', tone: telemetry.available ? 'active' : 'unknown', note: serverNote },
    { key: 'control', name: 'Control Plane', status: controlOnline ? 'Hoạt động' : 'Chưa xác minh', tone: controlOnline ? 'active' : 'unknown', note: controlOnline ? (telemetry.controller?.port ? `Cổng ${telemetry.controller.port} phản hồi` : 'Controller phản hồi') : 'Chưa có phản hồi Controller' },
    { key: 'web', name: 'Web Local', status: 'Hoạt động', tone: 'active', note: 'Renderer hiện hành đang phục vụ trang này' },
    { key: 'worker', name: 'Auto Worker', status: workerOnline ? 'Hoạt động' : 'Chưa xác minh', tone: workerOnline ? 'active' : 'unknown', note: workerOnline ? `${telemetry.worker?.instances ?? 0} instance đang chạy` : 'Chưa xác minh Worker' },
  ];
}

export async function loadExecutiveDashboardV4(repo: string, telemetry: ServerTelemetry): Promise<ExecutiveDashboardV4> {
  const [central, centralCommentsRaw, registry] = await Promise.all([
    ghJson<Issue>(repo, 'issues/280').catch(() => null),
    ghJson<Comment[]>(repo, 'issues/280/comments?per_page=100').catch(() => []),
    ghJson<Issue>(repo, 'issues/335').catch(() => null),
  ]);
  const centralComments = Array.isArray(centralCommentsRaw) ? centralCommentsRaw : [];
  const current = resolvePriorityIssueNumber(central, centralComments);
  const laneNumbers = resolveLaneNumbers(central, current);
  const lanes = (await Promise.all(laneNumbers.map(async (number): Promise<Lane | null> => {
    const [issue, comments] = await Promise.all([
      ghJson<Issue>(repo, `issues/${number}`).catch(() => null),
      ghJson<Comment[]>(repo, `issues/${number}/comments?per_page=100`).catch(() => []),
    ]);
    return issue ? { issue, comments: Array.isArray(comments) ? comments : [] } : null;
  }))).filter((lane): lane is Lane => lane !== null);

  const paused = nv03Paused(registry, central);
  const works = lanes.map((lane): ExecutiveWorkV4 => {
    const code = ownerCode(lane.issue, lane.comments);
    const life = code === 'NV03' && paused ? { status: 'Tạm ngưng', tone: 'paused' as Tone, current: 'Theo Registry #335' } : lifecycle(lane.comments, lane.issue);
    const percent = progressPercent(lane.issue, lane.comments);
    return {
      number: Number(lane.issue.number || 0) || null,
      title: compact(String(lane.issue.title ?? 'Chưa có tiêu đề').replace(/^\[[^\]]+\]\s*/g, ''), 96),
      ownerCode: code,
      owner: ownerName(code),
      progressPercent: percent,
      progressLabel: percent === null ? (life.tone === 'done' ? '100%' : '—') : `${percent}%`,
      status: life.status,
      tone: life.tone,
      next: nextMilestone(lane.issue),
      updated: lane.issue.updated_at ? new Date(lane.issue.updated_at).toLocaleString('vi-VN', { hour12: false }) : '—',
    };
  });

  const allComments = [...centralComments, ...lanes.flatMap((lane) => lane.comments)];
  const action = ownerAction(allComments);
  const defs: Array<[EmployeeCode, string, string, string]> = [
    ['NV01', 'MI', 'Minh (NV01)', 'Thực thi trực tiếp'],
    ['NV02', 'KH', 'Khoa (NV02)', 'Vận hành tự động'],
    ['NV03', 'HU', 'Huy (NV03)', 'Kỹ sư Hệ thống Local'],
    ['NV04', 'K', 'Khải (NV04)', 'Kỹ sư Tích hợp AI/API'],
  ];
  const people: ExecutivePersonV4[] = [{ key: 'VY', initials: 'VY', name: 'Vy (Trợ lý)', role: 'Điều phối', status: 'Điều phối', tone: 'active', current: 'Hỗ trợ vận hành dự án', activeCount: 0 }];
  for (const [code, initials, name, role] of defs) {
    const owned = works.filter((work) => work.ownerCode === code);
    const active = owned.filter((work) => work.tone === 'active').length;
    const representative = owned[0];
    const isPaused = code === 'NV03' && paused;
    people.push({
      key: code,
      initials,
      name,
      role,
      status: isPaused ? 'Tạm ngưng' : active > 0 ? 'Đang làm' : representative?.status ?? 'Chờ việc',
      tone: isPaused ? 'paused' : active > 0 ? 'active' : representative?.tone ?? 'waiting',
      current: isPaused ? 'Cấu hình AI PC01 và hệ thống local' : representative ? compact(representative.title, 58) : 'Chưa có việc đang giữ',
      activeCount: active,
    });
  }

  const verifiedProgress = works.map((work) => work.progressPercent).filter((value): value is number => typeof value === 'number');
  const progressAverage = verifiedProgress.length ? Math.round(verifiedProgress.reduce((sum, value) => sum + value, 0) / verifiedProgress.length) : null;
  return {
    generatedAt: new Date().toISOString(),
    works,
    people,
    systems: systemRows(telemetry),
    activeCount: works.filter((work) => work.tone === 'active').length,
    waitingCount: works.filter((work) => work.tone === 'waiting').length,
    blockedCount: works.filter((work) => work.tone === 'blocked').length,
    doneCount: works.filter((work) => work.tone === 'done').length,
    pausedCount: works.filter((work) => work.tone === 'paused').length,
    progressAverage,
    ownerActionRequired: action.required,
    ownerActionText: action.text,
  };
}
