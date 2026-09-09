import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ServerTelemetry } from './server.js';

const execFileAsync = promisify(execFile);

type Issue = { number?: number; title?: string; body?: string | null; state?: string; updated_at?: string; html_url?: string | null };
type Comment = { body?: string | null; created_at?: string | null; updated_at?: string | null; html_url?: string | null };
type EmployeeCode = 'NV01' | 'NV02' | 'NV03' | 'NV04';
type Tone = 'active' | 'waiting' | 'blocked' | 'done' | 'paused' | 'stale' | 'unknown';
const WORK_STALE_MS = Math.max(30_000, Number(process.env.TIGERIQ_WEB_WORK_STALE_MS) || 120_000);

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
  workId?: string;
  projectId?: string;
  project?: string;
  priority?: string;
  goal?: string;
  currentStep?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  evidenceRef?: string;
  timeline?: Array<{ timestamp: string; message: string; evidenceRef?: string }>;
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
  sourceStatus?: string;
  sourceNote?: string;
  sourceUpdatedAt?: string;
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

async function ghJsonPages<T>(repo: string, endpoint: string, maxPages = 5): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const join = endpoint.includes('?') ? '&' : '?';
    const batch = await ghJson<T[]>(repo, `${endpoint}${join}per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
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

function humanizeIssueTitle(number: number | null, raw: string): string {
  const known: Record<number,string> = {
    511: 'Kế hoạch Web Control V5 — dữ liệu sống + giao diện quản trị + điều khiển + xuất bản',
    507: 'Web Control thành phòng điều hành sống — thời gian thực + xem chi tiết + chức năng theo vai trò',
    497: 'Tự động hóa trình duyệt đăng nhập — quyền thường trực + hàng rào an toàn',
    486: 'Cầu điều khiển Web Control — thao tác thực tế + tự phục hồi',
  };
  if (number && known[number]) return known[number];
  return raw.replace(/^(?:\[[^\]]+\]\s*)+/, '').replace(/\brollout\b/gi,'xuất bản').replace(/\bdrill-down\b/gi,'xem chi tiết');
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
    const step = [...text.matchAll(/(?:^|\n)(?:current_step|step|current|bước_hiện_tại|buoc_hien_tai)=([^\n]+)/gi)].at(-1)?.[1]?.trim();
    const current = compact(step || state || text.split(/\r?\n/).find((line) => line.trim()) || 'Có cập nhật', 120);
    if (/^TIGERIQ_(?:JOB|COMMAND|PC01)_FAILED\b/im.test(text)) return { status: 'Vướng mắc', tone: 'blocked', current };
    if (/^TIGERIQ_(?:JOB|COMMAND|PC01)_(?:DONE|RESULT)\b/im.test(text)) return { status: 'Hoàn tất', tone: 'done', current };
    if (/^TIGERIQ_(?:JOB|COMMAND|PC01)_(?:CLAIMED|HEARTBEAT)\b/im.test(text)) {
      const ageMs = Date.now() - commentTime(comment);
      return ageMs > WORK_STALE_MS
        ? { status: 'Mất tín hiệu', tone: 'stale', current }
        : { status: 'Đang làm', tone: 'active', current };
    }
    if (state && /HOÀN_TẤT|HOÀN TẤT|DONE|COMPLETED/i.test(state)) return { status: 'Hoàn tất', tone: 'done', current };
    if (state && /LỖI|FAILED|BỊ_CHẶN|BỊ CHẶN|BLOCKED/i.test(state)) return { status: 'Vướng mắc', tone: 'blocked', current };
    if (state && /TẠM_NGƯNG|TẠM NGƯNG|PAUSED/i.test(state)) return { status: 'Tạm ngưng', tone: 'paused', current };
    if (state && /CHỜ|WAIT|PENDING/i.test(state)) return { status: 'Chờ xử lý', tone: 'waiting', current };
  }
  return { status: 'Chờ xác minh thực thi', tone: 'waiting', current: 'Chưa có quyền giữ việc, nhịp sống hoặc bằng chứng mới' };
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
  const body = String(central?.body ?? '');
  const currentBody = body.match(/##\s*CURRENT P0[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i)?.[1] ?? '';
  const bodyFirst = currentBody.match(/^\s*1\.\s+.*?#(\d+)/mi) || body.match(/##\s*P0 hiện hành[^\n]*#(\d+)/i);
  if (bodyFirst) return Number(bodyFirst[1]);
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
  const body = String(central?.body ?? '');
  const currentBlock = body.match(/##\s*CURRENT P0[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i)?.[1] ?? section(body, 'Ưu tiên hiện hành');
  const numbers: number[] = [];
  for (const line of currentBlock.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\.\s+.*?#(\d+)/);
    if (match) numbers.push(Number(match[1]));
  }
  if (currentNumber) numbers.unshift(currentNumber);
  return [...new Set(numbers.filter((value) => Number.isInteger(value) && value > 0))].slice(0, 5);
}

function resolveScopedIssueNumbers(registry: Issue | null): number[] {
  const text = String(registry?.body ?? '');
  const numbers: number[] = [];
  if (/\| `511` \|[^\n]*\| true \|/i.test(text)) numbers.push(511);
  const apiScope = text.match(/- `4`:[^\n]*scope hiện hành #(\d+)/i);
  if (apiScope) numbers.push(Number(apiScope[1]));
  return [...new Set(numbers.filter((value) => Number.isInteger(value) && value > 0))];
}

function nv03Paused(registry: Issue | null, central: Issue | null): boolean {
  const registryText = String(registry?.body ?? '');
  const centralText = String(central?.body ?? '');
  return /NV03[^\n]*active=false[^\n]*TẠM NGƯNG/i.test(registryText)
    || /`3`[^\n]*false[^\n]*(?:TẠM NGƯNG|PAUSED)/i.test(registryText)
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

export function systemRows(telemetry: ServerTelemetry): ExecutiveSystemV4[] {
  const cpu = telemetry.cpu?.utilizationPercent;
  const ram = telemetry.memory?.utilizationPercent;
  const serverNote = telemetry.available
    ? [typeof cpu === 'number' ? `CPU ${Math.round(cpu)}%` : null, typeof ram === 'number' ? `RAM ${Math.round(ram)}%` : null, telemetry.disk?.drive ? `Disk ${telemetry.disk.drive}` : null].filter(Boolean).join(' · ') || 'Máy chủ có phản hồi'
    : 'Chưa có telemetry máy chủ';
  const state = (online: boolean | null | undefined, ok: string, missing: string): Pick<ExecutiveSystemV4,'status'|'tone'|'note'> => online === true ? { status: 'Hoạt động', tone: 'active', note: ok } : online === false ? { status: 'Không hoạt động', tone: 'blocked', note: missing } : { status: 'Chưa xác minh', tone: 'unknown', note: missing };
  const control = state(telemetry.controller?.online, telemetry.controller?.port ? `Cổng ${telemetry.controller.port} phản hồi` : 'Controller phản hồi', 'Chưa có phản hồi Controller');
  const worker = state(telemetry.worker?.online, `${telemetry.worker?.instances ?? 0} tiến trình · PID ${telemetry.worker?.pid ?? '—'}`, 'Chưa xác minh Native Worker');
  const postgres = state(telemetry.postgresql?.online, `Cổng ${telemetry.postgresql?.port ?? 5432} phản hồi`, 'Chưa xác minh PostgreSQL');
  const ollama = state(telemetry.ollama?.online, `${telemetry.ollama?.models?.length ?? 0} mô hình cục bộ`, 'Chưa xác minh Ollama');
  const stages = telemetry.jobStages ?? {};
  const queueNote = `queued ${stages.queued ?? 0} · leased ${stages.leased ?? 0} · reviewing ${stages.reviewing ?? 0} · judging ${stages.judging ?? 0} · done ${stages.done ?? 0} · failed ${stages.failed ?? 0}`;
  const providerRows: ExecutiveSystemV4[] = (telemetry.providers ?? []).map((provider) => ({ key: `provider-${provider.providerId}`, name: `Provider · ${provider.provider}`, status: provider.state === 'active' && !provider.stale ? 'Hoạt động' : provider.stale ? 'Stale' : provider.state, tone: provider.state === 'active' && !provider.stale ? 'active' : provider.stale ? 'blocked' : 'unknown', note: `${provider.model} · heartbeat ${provider.lastHeartbeatAt ?? 'chưa có'}` }));
  return [
    { key: 'pc01', name: 'Máy chủ PC01', status: telemetry.available ? 'Hoạt động' : 'Chưa xác minh', tone: telemetry.available ? 'active' : 'unknown', note: serverNote },
    { key: 'control', name: 'Bộ điều phối công việc', ...control },
    { key: 'worker', name: 'Tiến trình thực thi PC01', ...worker },
    { key: 'planner', name: 'Bộ lập kế hoạch', status: 'Chưa xác minh', tone: 'unknown', note: 'Chưa có nguồn trạng thái trực tiếp trong Web V5' },
    { key: 'orchestrator', name: 'Bộ điều phối nhiệm vụ', status: 'Chưa xác minh', tone: 'unknown', note: 'Chưa có nguồn trạng thái trực tiếp trong Web V5' },
    { key: 'supervisor', name: 'Giám sát tự vận hành', status: 'Chưa xác minh', tone: 'unknown', note: 'Chưa có nguồn trạng thái trực tiếp trong Web V5' },
    { key: 'web', name: 'Web Control', status: 'Hoạt động', tone: 'active', note: 'Web V5 hiện hành đang phục vụ trang này' },
    { key: 'postgresql', name: 'PostgreSQL', ...postgres },
    { key: 'ollama', name: 'Ollama', ...ollama },
    { key: 'runtime-truth', name: 'Runtime truth', status: telemetry.truthSource ? 'Hoạt động' : 'Chưa xác minh', tone: telemetry.truthSource ? 'active' : 'unknown', note: telemetry.truthSource ? `${telemetry.truthSource} · stale ${telemetry.staleAfterMs ?? '—'}ms` : 'Chưa có nguồn runtime truth' },
    { key: 'queue', name: 'Queue / Job lifecycle', status: 'Runtime', tone: 'active', note: queueNote },
    ...providerRows,
    { key: 'openclaw', name: 'OpenClaw', status: 'Chưa xác minh', tone: 'unknown', note: 'Chưa có nguồn trạng thái trực tiếp trong Web V5' },
    { key: 'browser', name: 'Kênh trình duyệt', status: 'Chưa xác minh', tone: 'unknown', note: 'Chưa có nguồn trạng thái trực tiếp trong Web V5' },
    { key: 'remote', name: 'Điều khiển PC từ xa', status: 'Chưa xác minh', tone: 'unknown', note: 'Chưa có nguồn trạng thái trực tiếp trong Web V5' },
  ];
}

type RuntimeTaskViewV5 = import('./server.js').WorkforceTaskTelemetry & { createdAt?:string|null; updatedAt?:string|null; leaseId?:string|null; leaseEmployeeId?:string|null; leasedAt?:string|null; workerHeartbeatAt?:string|null; workerOnline?:boolean; workerStale?:boolean; sourceRef?:string; lastFailureCode?:string|null };
type RuntimeEmployeeViewV5 = import('./server.js').WorkforceEmployeeTelemetry & { lastHeartbeatAt?:string|null; stale?:boolean };
function runtimeStageToneV5(stage:string,hasLease:boolean,freshWorker:boolean):Tone{if(stage==='done')return 'done';if(stage==='failed')return 'blocked';if(stage==='cancelled')return 'paused';if(['leased','reviewing','judging'].includes(stage)&&hasLease)return freshWorker?'active':'stale';return 'waiting';}
function runtimeStageLabelV5(stage:string,tone:Tone):string{if(tone==='active')return 'Đang làm';if(tone==='stale')return 'Mất tín hiệu';if(stage==='done')return 'Hoàn tất';if(stage==='failed')return 'Vướng mắc';if(stage==='cancelled')return 'Tạm ngưng';if(stage==='queued')return 'Chờ xử lý';return 'Chờ runtime worker';}
export function mergeRuntimeWorkTruthV5(governanceWorks:ExecutiveWorkV4[],telemetry:ServerTelemetry,nowMs=Date.now()):ExecutiveWorkV4[]{
  const governance=governanceWorks.map((work)=>['active','stale'].includes(work.tone)?{...work,status:'Chờ xác minh thực thi',tone:'waiting' as Tone,currentStep:'GitHub chỉ là metadata; cần lease + heartbeat runtime để claim đang chạy.'}:work);
  const staleAfter=Math.max(5_000,telemetry.staleAfterMs??45_000),employees=(telemetry.workforce?.roster??[]) as RuntimeEmployeeViewV5[];
  const employeeById=new Map(employees.map((row)=>[row.employeeId,row])),tasks=(telemetry.workforce?.taskList??[]) as RuntimeTaskViewV5[];
  const selected=[...tasks].sort((a,b)=>Date.parse(b.updatedAt??'')-Date.parse(a.updatedAt??'')).filter((task,index)=>task.stage!=='done'||index<8).slice(0,32);
  const runtime=selected.map((task):ExecutiveWorkV4=>{const employeeId=task.leaseEmployeeId??task.assignedEmployeeId??null,employee=employeeId?employeeById.get(employeeId):undefined,hb=task.workerHeartbeatAt??employee?.lastHeartbeatAt??null,hbAt=Date.parse(hb??''),fresh=task.workerOnline===true&&task.workerStale!==true&&Number.isFinite(hbAt)&&nowMs-hbAt<=staleAfter,hasLease=Boolean(task.leaseId),tone=runtimeStageToneV5(task.stage,hasLease,fresh),last=tone==='active'||tone==='stale'?hb??task.updatedAt:task.updatedAt??hb,code=employeeId?employeeCode(employeeId):null;return {number:null,title:compact(task.objective||task.taskId,96),ownerCode:code,owner:employee?.displayName??employeeId??'Runtime worker',progressPercent:null,progressLabel:tone==='done'?'100%':'—',status:runtimeStageLabelV5(task.stage,tone),tone,next:task.stage==='queued'?'Chờ worker nhận việc':task.stage==='failed'?(task.lastFailureCode??'Xem lỗi runtime'):task.stage==='done'?'Đã hoàn tất':`Runtime stage: ${task.stage}`,updated:task.updatedAt?new Date(task.updatedAt).toLocaleString('vi-VN',{hour12:false}):'—',workId:task.taskId,projectId:'project:tigeriq',project:'TigerIQ',priority:task.priority,goal:compact(task.objective,220),currentStep:`Runtime · ${task.stage}`,updatedAt:task.updatedAt??undefined,lastActivityAt:last??undefined,evidenceRef:task.sourceRef??`runtime-truth-v1:job:${task.taskId}`,timeline:[...(task.leasedAt?[{timestamp:task.leasedAt,message:'Worker nhận lease',evidenceRef:`runtime-truth-v1:job:${task.taskId}`}]:[]),...(task.updatedAt?[{timestamp:task.updatedAt,message:`Runtime stage: ${task.stage}`,evidenceRef:`runtime-truth-v1:job:${task.taskId}`}]:[])]};});
  const ids=new Set(runtime.map((work)=>work.workId).filter(Boolean));return [...runtime,...governance.filter((work)=>!work.workId||!ids.has(work.workId))];
}

export async function loadExecutiveDashboardV4(repo: string, telemetry: ServerTelemetry): Promise<ExecutiveDashboardV4> {
  const [central, centralCommentsRaw, registry] = await Promise.all([
    ghJson<Issue>(repo, 'issues/280').catch(() => null),
    ghJsonPages<Comment>(repo, 'issues/280/comments').catch(() => []),
    ghJson<Issue>(repo, 'issues/335').catch(() => null),
  ]);
  const centralComments = Array.isArray(centralCommentsRaw) ? centralCommentsRaw : [];
  const current = resolvePriorityIssueNumber(central, centralComments);
  const laneNumbers = [...new Set([...resolveLaneNumbers(central, current), ...resolveScopedIssueNumbers(registry)])].slice(0, 8);
  const lanes = (await Promise.all(laneNumbers.map(async (number): Promise<Lane | null> => {
    const [issue, comments] = await Promise.all([
      ghJson<Issue>(repo, `issues/${number}`).catch(() => null),
      ghJsonPages<Comment>(repo, `issues/${number}/comments`).catch(() => []),
    ]);
    return issue ? { issue, comments: Array.isArray(comments) ? comments : [] } : null;
  }))).filter((lane): lane is Lane => lane !== null);

  const paused = nv03Paused(registry, central);
  const governanceWorks = lanes.map((lane): ExecutiveWorkV4 => {
    const code = ownerCode(lane.issue, lane.comments);
    const life = code === 'NV03' && paused ? { status: 'Tạm ngưng', tone: 'paused' as Tone, current: 'Theo Registry #335' } : lifecycle(lane.comments, lane.issue);
    const percent = progressPercent(lane.issue, lane.comments);
    const issueNumber = Number(lane.issue.number || 0) || null;
    const latestComment = [...lane.comments].sort((a, b) => commentTime(b) - commentTime(a))[0];
    const titleRaw = String(lane.issue.title ?? 'Chưa có tiêu đề');
    const bodyRaw = String(lane.issue.body ?? '');
    const priority = titleRaw.match(/\b(P[0-2])\b/i)?.[1]?.toUpperCase() ?? bodyRaw.match(/\b(P[0-2])\b/i)?.[1]?.toUpperCase() ?? '—';
    const timeline = [...lane.comments].sort((a, b) => commentTime(b) - commentTime(a)).slice(0, 8).map((row) => ({ timestamp: row.updated_at || row.created_at || '', message: compact(String(row.body ?? '').split(/\r?\n/).find(Boolean) || 'Có cập nhật', 140), ...(row.html_url ? { evidenceRef: row.html_url } : {}) }));
    return {
      number: issueNumber,
      title: compact(humanizeIssueTitle(issueNumber, String(lane.issue.title ?? 'Chưa có tiêu đề')), 96),
      ownerCode: code,
      owner: ownerName(code),
      progressPercent: percent,
      progressLabel: percent === null ? (life.tone === 'done' ? '100%' : '—') : `${percent}%`,
      status: life.status,
      tone: life.tone,
      next: nextMilestone(lane.issue),
      updated: lane.issue.updated_at ? new Date(lane.issue.updated_at).toLocaleString('vi-VN', { hour12: false }) : '—',
      workId: issueNumber ? `GH-${issueNumber}` : undefined,
      projectId: 'project:tigeriq', project: 'TigerIQ', priority,
      goal: compact(section(bodyRaw, 'Mục tiêu') || titleRaw, 220),
      currentStep: life.current, updatedAt: lane.issue.updated_at,
      lastActivityAt: latestComment?.updated_at || latestComment?.created_at || lane.issue.updated_at,
      evidenceRef: latestComment?.html_url || lane.issue.html_url || undefined, timeline,
    };
  });

  const works = mergeRuntimeWorkTruthV5(governanceWorks, telemetry);

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
    pausedCount: works.filter((work) => work.tone === 'paused' || work.tone === 'stale').length,
    progressAverage,
    ownerActionRequired: action.required,
    ownerActionText: action.text,
  };
}
