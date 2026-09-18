import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { WorkerId } from './model.js';

export const UI_JOB_STAGES = [
  'QUEUED','DISPATCHING','SUBMITTED','WORKING','WAITING_EVIDENCE','VERIFY','DONE','BLOCKED','ERROR',
] as const;
export type UiJobStage = (typeof UI_JOB_STAGES)[number];

export interface UiJobMetadata {
  jobId?: string;
  issueRef?: string;
  title?: string;
  source?: string;
}

export interface UiJobPatch {
  nextAction?: string | null;
  blocker?: string | null;
  evidenceRef?: string | null;
  result?: string | null;
}

export interface UiJobRecord {
  jobId: string;
  workerId: WorkerId;
  issueRef: string | null;
  title: string;
  source: string;
  stage: UiJobStage;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  lastActivityAt: string;
  completedAt: string | null;
  nextAction: string | null;
  blocker: string | null;
  evidenceRefs: string[];
  result: string | null;
}

interface LedgerFile {
  schemaVersion: 'tigeriq.chrome-controller.ui-job-ledger.v1';
  jobs: UiJobRecord[];
}

const TERMINAL = new Set<UiJobStage>(['DONE','BLOCKED','ERROR']);
const PROGRESS: Record<UiJobStage,number> = {
  QUEUED: 5,
  DISPATCHING: 15,
  SUBMITTED: 30,
  WORKING: 60,
  WAITING_EVIDENCE: 80,
  VERIFY: 90,
  DONE: 100,
  BLOCKED: 100,
  ERROR: 100,
};

export function isUiJobStage(value: unknown): value is UiJobStage {
  return typeof value === 'string' && (UI_JOB_STAGES as readonly string[]).includes(value);
}
export function isTerminalUiJobStage(stage: UiJobStage): boolean { return TERMINAL.has(stage); }
export function uiJobProgress(stage: UiJobStage): number { return PROGRESS[stage]; }

export class DurableUiJobLedger {
  private value: LedgerFile;
  constructor(private readonly path: string) {
    this.value = this.load();
  }

  private load(): LedgerFile {
    if (!existsSync(this.path)) return { schemaVersion:'tigeriq.chrome-controller.ui-job-ledger.v1', jobs:[] };
    try {
      const raw = JSON.parse(readFileSync(this.path,'utf8')) as Partial<LedgerFile>;
      if (!Array.isArray(raw.jobs)) throw new Error('UI_JOB_LEDGER_JOBS_INVALID');
      return { schemaVersion:'tigeriq.chrome-controller.ui-job-ledger.v1', jobs:raw.jobs as UiJobRecord[] };
    } catch {
      return { schemaVersion:'tigeriq.chrome-controller.ui-job-ledger.v1', jobs:[] };
    }
  }

  private save() {
    const temp=`${this.path}.tmp`;
    writeFileSync(temp,`${JSON.stringify(this.value,null,2)}\n`,'utf8');
    renameSync(temp,this.path);
  }

  snapshot(): UiJobRecord[] { return this.value.jobs.map((job)=>({...job,evidenceRefs:[...job.evidenceRefs]})); }

  latest(workerId: WorkerId): UiJobRecord | undefined {
    const jobs=this.value.jobs.filter((job)=>job.workerId===workerId);
    return jobs.length ? jobs[jobs.length-1] : undefined;
  }

  active(workerId: WorkerId): UiJobRecord | undefined {
    const jobs=this.value.jobs.filter((job)=>job.workerId===workerId&&!isTerminalUiJobStage(job.stage));
    return jobs.length ? jobs[jobs.length-1] : undefined;
  }

  create(workerId: WorkerId, metadata: UiJobMetadata = {}, now = new Date()): UiJobRecord {
    const existingActive=this.active(workerId);
    const requestedId=String(metadata.jobId??'').trim();
    if (existingActive) {
      if (!requestedId || existingActive.jobId!==requestedId) throw new Error(`UI_JOB_ACTIVE:${workerId}:${existingActive.jobId}`);
      throw new Error(`UI_JOB_DUPLICATE_ACTIVE:${workerId}:${existingActive.jobId}`);
    }
    const jobId=requestedId || `UI-${workerId}-${randomUUID()}`;
    if (this.value.jobs.some((job)=>job.jobId===jobId)) throw new Error(`UI_JOB_DUPLICATE_ID:${jobId}`);
    const at=now.toISOString();
    const record:UiJobRecord={
      jobId,
      workerId,
      issueRef:String(metadata.issueRef??'').trim()||null,
      title:String(metadata.title??'').trim()||'System-dispatched work',
      source:String(metadata.source??'').trim()||'MANUAL',
      stage:'QUEUED',
      progress:uiJobProgress('QUEUED'),
      createdAt:at,
      startedAt:null,
      lastActivityAt:at,
      completedAt:null,
      nextAction:'Dispatch to worker',
      blocker:null,
      evidenceRefs:[],
      result:null,
    };
    this.value.jobs.push(record);
    this.save();
    return {...record,evidenceRefs:[]};
  }

  transition(workerId: WorkerId, jobId: string, stage: UiJobStage, patch: UiJobPatch = {}, now = new Date()): UiJobRecord {
    const record=this.value.jobs.find((job)=>job.workerId===workerId&&job.jobId===jobId);
    if (!record) throw new Error(`UI_JOB_NOT_FOUND:${workerId}:${jobId}`);
    const at=now.toISOString();
    record.stage=stage;
    record.progress=uiJobProgress(stage);
    record.lastActivityAt=at;
    if (!record.startedAt && ['DISPATCHING','SUBMITTED','WORKING','WAITING_EVIDENCE','VERIFY','DONE'].includes(stage)) record.startedAt=at;
    record.completedAt=isTerminalUiJobStage(stage)?at:null;
    if (patch.nextAction!==undefined) record.nextAction=patch.nextAction;
    else if (stage==='WORKING') record.nextAction='Continue current work';
    else if (stage==='WAITING_EVIDENCE') record.nextAction='Attach authoritative evidence';
    else if (stage==='VERIFY') record.nextAction='Verify acceptance gates';
    else if (stage==='DONE') record.nextAction=null;
    if (patch.blocker!==undefined) record.blocker=patch.blocker;
    if (patch.result!==undefined) record.result=patch.result;
    if (patch.evidenceRef) {
      const ref=patch.evidenceRef.trim();
      if (ref && !record.evidenceRefs.includes(ref)) record.evidenceRefs.push(ref);
    }
    this.save();
    return {...record,evidenceRefs:[...record.evidenceRefs]};
  }

  transitionActive(workerId: WorkerId, stage: UiJobStage, patch: UiJobPatch = {}, now = new Date()): UiJobRecord | undefined {
    const active=this.active(workerId);
    if (!active) return undefined;
    return this.transition(workerId,active.jobId,stage,patch,now);
  }
}
