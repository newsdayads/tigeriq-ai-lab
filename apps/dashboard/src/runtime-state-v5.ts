import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EmployeeCode, ExecutiveDashboardV4, ExecutivePersonV4, ExecutiveWorkV4 } from './executive-data-v4.js';

export type RuntimePulseV5 = {
  schema?: number;
  workId?: string;
  issueNumber?: number;
  title?: string;
  ownerCode?: EmployeeCode;
  owner?: string;
  priority?: string;
  projectId?: string;
  project?: string;
  status?: 'active' | 'blocked' | 'waiting' | 'done' | 'paused';
  currentStep?: string;
  next?: string;
  startedAt?: string;
  heartbeatAt?: string;
  evidenceRef?: string;
};

export type RuntimeStateV5Options = {
  snapshotPath?: string;
  pulsePath?: string;
};
const SNAPSHOT_DEFAULT = 'D:\\TigerIQ\\CommandCenter\\web-v5-data-cache.json';
const PULSE_DEFAULT = 'D:\\TigerIQ\\CommandCenter\\web-control-activity.json';
const ACTIVE_TTL_MS = 6 * 60 * 60 * 1000;
function ensureCanonicalRosterV5(people: ExecutivePersonV4[]): ExecutivePersonV4[] {
  const current = new Map(people.map((person) => [person.key, person]));
  return [...current.values()];
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
}

async function saveSnapshot(path: string, data: ExecutiveDashboardV4): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Snapshot is resilience-only; rendering must not fail when disk write is unavailable.
  }
}

function pulseTone(pulse: RuntimePulseV5): ExecutiveWorkV4['tone'] {
  if (pulse.status === 'done') return 'done';
  if (pulse.status === 'blocked') return 'blocked';
  if (pulse.status === 'paused') return 'paused';
  if (pulse.status === 'waiting') return 'waiting';
  const at = Date.parse(pulse.heartbeatAt || pulse.startedAt || '');
  return Number.isFinite(at) && Date.now() - at <= ACTIVE_TTL_MS ? 'active' : 'stale';
}
function pulseStatus(tone: ExecutiveWorkV4['tone']): string {
  if (tone === 'active') return 'Đang làm';
  if (tone === 'blocked') return 'Bị chặn';
  if (tone === 'done') return 'Hoàn tất';
  if (tone === 'paused') return 'Tạm ngưng';
  if (tone === 'stale') return 'Mất tín hiệu';
  return 'Chờ xử lý';
}

function workFromPulse(pulse: RuntimePulseV5): ExecutiveWorkV4 | null {
  if (!pulse.workId && !pulse.issueNumber) return null;
  const tone = pulseTone(pulse);
  const number = Number(pulse.issueNumber || String(pulse.workId || '').match(/GH-(\d+)/i)?.[1] || 0) || null;
  return {
    number,
    title: pulse.title || 'Công việc điều hành hiện tại',
    ownerCode: pulse.ownerCode ?? null,
    owner: pulse.owner || pulse.ownerCode || 'Chưa xác minh',
    progressPercent: tone === 'done' ? 100 : null,
    progressLabel: tone === 'done' ? '100%' : '—',
    status: pulseStatus(tone),
    tone,
    next: pulse.next || 'Theo bước điều hành hiện tại',
    updated: pulse.heartbeatAt || pulse.startedAt || '—',
    workId: pulse.workId || (number ? `GH-${number}` : undefined),
    projectId: pulse.projectId || 'project:tigeriq',
    project: pulse.project || 'TigerIQ AI Lab',
    priority: pulse.priority || 'P0',
    goal: pulse.title || 'Công việc điều hành hiện tại',
    currentStep: pulse.currentStep || 'Chưa có bước hiện tại',
    updatedAt: pulse.heartbeatAt || pulse.startedAt,
    lastActivityAt: pulse.heartbeatAt || pulse.startedAt,
    evidenceRef: pulse.evidenceRef,
    timeline: [{
      timestamp: pulse.heartbeatAt || pulse.startedAt || new Date().toISOString(),
      message: pulse.currentStep || pulseStatus(tone),
      ...(pulse.evidenceRef ? { evidenceRef: pulse.evidenceRef } : {}),
    }],
  };
}

function mergePulse(works: ExecutiveWorkV4[], pulse: RuntimePulseV5 | null): ExecutiveWorkV4[] {
  if (!pulse) return works;
  const current = workFromPulse(pulse);
  if (!current) return works;
  const id = current.workId;
  const rest = works.filter((work) => (work.workId || (work.number ? `GH-${work.number}` : '')) !== id);
  return [current, ...rest];
}
function recalc(data: ExecutiveDashboardV4, works: ExecutiveWorkV4[], sourceStatus: string, sourceNote: string): ExecutiveDashboardV4 {
  const canonicalPeople = ensureCanonicalRosterV5(data.people);
  const canonicalNames = new Map(canonicalPeople.flatMap((person) => person.key === 'VY' ? [] : [[person.key, person.name] as const]));
  const normalizedWorks = works.map((work) => work.ownerCode && canonicalNames.has(work.ownerCode)
    ? { ...work, owner: canonicalNames.get(work.ownerCode) ?? work.owner }
    : work);
  const people = canonicalPeople.map((person) => {
    if (person.key === 'VY') return person;
    const owned = normalizedWorks.filter((work) => work.ownerCode === person.key && work.tone !== 'done');
    const current = owned.find((work) => work.tone === 'active') || owned.find((work) => work.tone === 'blocked' || work.tone === 'stale') || owned[0];
    if (!current) return { ...person, activeCount: 0 };
    const status = current.tone === 'active' ? 'RUNNING (đang làm thật)'
      : current.tone === 'blocked' ? 'BLOCKED (bị chặn)'
      : current.tone === 'paused' ? 'PAUSED (tạm dừng)'
      : current.tone === 'waiting' ? 'QUEUED (đang chờ nhận)'
      : 'READY (sẵn sàng)';
    const tone = current.tone === 'stale' ? 'waiting' as const : current.tone === 'done' ? 'waiting' as const : current.tone;
    return { ...person, status, tone, current: current.title, activeCount: owned.filter((work) => work.tone === 'active').length };
  });
  const verified = normalizedWorks.map((work) => work.progressPercent).filter((value): value is number => typeof value === 'number');
  return {
    ...data, works: normalizedWorks, people,
    activeCount: normalizedWorks.filter((work) => work.tone === 'active').length,
    waitingCount: normalizedWorks.filter((work) => work.tone === 'waiting').length,
    blockedCount: normalizedWorks.filter((work) => work.tone === 'blocked').length,
    doneCount: normalizedWorks.filter((work) => work.tone === 'done').length,
    pausedCount: normalizedWorks.filter((work) => work.tone === 'paused' || work.tone === 'stale').length,
    progressAverage: verified.length ? Math.round(verified.reduce((a,b) => a + b, 0) / verified.length) : null,
    sourceStatus, sourceNote, sourceUpdatedAt: new Date().toISOString(),
  };
}
export async function stabilizeExecutiveDataV5(data: ExecutiveDashboardV4, options: RuntimeStateV5Options = {}): Promise<ExecutiveDashboardV4> {
  const snapshotPath = options.snapshotPath ?? SNAPSHOT_DEFAULT;
  const pulsePath = options.pulsePath ?? PULSE_DEFAULT;
  let base = data;
  let sourceStatus = 'Nguồn trực tiếp';
  let sourceNote = 'GitHub/TigerIQ và trạng thái PC01 đang phản hồi.';

  if (data.works.length > 0) {
    await saveSnapshot(snapshotPath, data);
  } else {
    const cached = await readJson<ExecutiveDashboardV4>(snapshotPath);
    if (cached?.works?.length) {
      base = { ...cached, generatedAt: data.generatedAt, systems: data.systems };
      sourceStatus = 'Bản lưu gần nhất';
      sourceNote = 'Nguồn động đang thiếu dữ liệu; Web giữ bản xác minh gần nhất và tiếp tục nhận trạng thái PC01.';
    } else {
      sourceStatus = 'Nguồn động chưa đủ';
      sourceNote = 'Chưa có bản lưu công việc; chỉ hiển thị trạng thái PC01 và phiên điều hành hiện tại.';
    }
  }

  const pulse = await readJson<RuntimePulseV5>(pulsePath);
  const works = mergePulse(base.works, pulse);
  if (pulse && workFromPulse(pulse)) {
    sourceStatus = sourceStatus === 'Nguồn trực tiếp' ? 'Nguồn trực tiếp + phiên điều hành' : `${sourceStatus} + phiên điều hành`;
    sourceNote = `${sourceNote} Phiên điều hành PC01 đang ghi nhận ${pulse.workId || `GH-${pulse.issueNumber}`}.`;
  }
  return recalc(base, works, sourceStatus, sourceNote);
}
