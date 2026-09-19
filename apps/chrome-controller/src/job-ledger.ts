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
const ALLOWED_NEXT: Record<UiJobStage,ReadonlySet<UiJobStage>> = {
  QUEUED: new Set(['DISPATCHING','BLOCKED','ERROR']),
  DISPATCHING: new Set(['SUBMITTED','BLOCKED','ERROR']),
  SUBMITTED: new Set(['WORKING','WAITING_EVIDENCE','BLOCKED','ERROR']),
  WORKING: new Set(['WAITING_EVIDENCE','BLOCKED','ERROR']),
  WAITING_EVIDENCE: new Set(['VERIFY','BLOCKED','ERROR']),
  VERIFY: new Set(['DONE','BLOCKED','ERROR']),
  DONE: new Set(),
  BLOCKED: new Set(),
  ERROR: new Set(),
};
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
export function reconcileUiJobStage(stage: UiJobStage, uiBusy: boolean|null|undefined): UiJobStage|undefined {
  if (uiBusy===true && stage==='SUBMITTED') return 'WORKING';
  if (uiBusy===false && (stage==='SUBMITTED'||stage==='WORKING')) return 'WAITING_EVIDENCE';
  return undefined;
}

export class DurableUiJobLedger {
  private value: LedgerFile;
  constructor(private readonly path: string) {
    this.value = this.load();
  }

  private load(): LedgerFile {
    if (!existsSync(this.path)) return { schemaVersion:'tigeriq.chrome-controller.ui-job-ledger.v1', jobs:[] };
    let raw: Partial<LedgerFile>;
    try {
      raw = JSON.parse(readFileSync(this.path,'utf8')) as Partial<LedgerFile>;
    } catch (error) {
      throw new Error(`UI_JOB_LEDGER_CORRUPT:${String(error)}`);
    }
    if (raw.schemaVersion !== 'tigeriq.chrome-controller.ui-job-ledger.v1') throw new Error('UI_JOB_LEDGER_SCHEMA_INVALID');
    if (!Array.isArray(raw.jobs)) throw new Error('UI_JOB_LEDGER_JOBS_INVALID');
    for (const job of raw.jobs) {
      if (!job || typeof job!=='object' || !job.jobId || !job.workerId || !isUiJobStage(job.stage))
        throw new Error('UI_JOB_LEDGER_RECORD_INVALID');
      if (job.progress !== uiJobProgress(job.stage)) throw new Error(`UI_JOB_LEDGER_PROGRESS_INVALID:${job.jobId}`);
      if (!Array.isArray(job.evidenceRefs)) throw new Error(`UI_JOB_LEDGER_EVIDENCE_INVALID:${job.jobId}`);
    }
    return { schemaVersion:'tigeriq.chrome-controller.ui-job-ledger.v1', jobs:raw.jobs as UiJobRecord[] };
  }

  private save() {
    const temp=`${this.path}.tmp`;
    writeFileSync(temp,`${JSON.stringify(this.value,null,2)}\n`,'utf8');
    renameSync(temp,this.path);
  }

  snapshot(): UiJobRecord[] { return this.value.jobs.map((job)=>({...job,evidenceRefs:[...job.evidenceRefs]})); }

  get(workerId: WorkerId, jobId: string): UiJobRecord | undefined {
    const job=this.value.jobs.find((item)=>item.workerId===workerId&&item.jobId===jobId);
    return job ? {...job,evidenceRefs:[...job.evidenceRefs]} : undefined;
  }

  latest(workerId: WorkerId): UiJobRecord | undefined {
    const jobs=this.value.jobs.filter((job)=>job.workerId===workerId);
    const job=jobs.length ? jobs[jobs.length-1] : undefined;
    return job ? {...job,evidenceRefs:[...job.evidenceRefs]} : undefined;
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

  retryError(workerId: WorkerId, jobId: string, metadata: UiJobMetadata = {}, now = new Date()): UiJobRecord {
    if (this.active(workerId)) throw new Error(`UI_JOB_ACTIVE:${workerId}:${this.active(workerId)!.jobId}`);
    const record=this.value.jobs.find((job)=>job.workerId===workerId&&job.jobId===jobId);
    if (!record) throw new Error(`UI_JOB_NOT_FOUND:${workerId}:${jobId}`);
    if (record.stage!=='ERROR') throw new Error(`UI_JOB_RETRY_REQUIRES_ERROR:${record.stage}`);
    const at=now.toISOString();
    if (metadata.issueRef!==undefined) record.issueRef=String(metadata.issueRef??'').trim()||null;
    if (metadata.title!==undefined) record.title=String(metadata.title??'').trim()||record.title;
    if (metadata.source!==undefined) record.source=String(metadata.source??'').trim()||record.source;
    record.stage='QUEUED';
    record.progress=uiJobProgress('QUEUED');
    record.lastActivityAt=at;
    record.completedAt=null;
    record.nextAction='Retry dispatch to worker';
    record.blocker=null;
    record.result=null;
    this.save();
    return {...record,evidenceRefs:[...record.evidenceRefs]};
  }

  transition(workerId: WorkerId, jobId: string, stage: UiJobStage, patch: UiJobPatch = {}, now = new Date()): UiJobRecord {
    const record=this.value.jobs.find((job)=>job.workerId===workerId&&job.jobId===jobId);
    if (!record) throw new Error(`UI_JOB_NOT_FOUND:${workerId}:${jobId}`);
    if (record.stage!==stage && !ALLOWED_NEXT[record.stage].has(stage))
      throw new Error(`UI_JOB_TRANSITION_INVALID:${record.stage}->${stage}`);
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
