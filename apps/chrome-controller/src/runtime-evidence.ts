import { randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { WORKER_IDS, computePlacements, workAreaFitsLayout, type ControllerConfig, type WindowPlacement, type WorkArea, type WorkerId } from './model.js';
import type { DurableAutopilotState, ExternalAutopilotSnapshot } from './autopilot.js';
import type { UiJobRecord } from './job-ledger.js';

export interface DurableDispatchEvidenceState {
  schemaVersion: 'tigeriq.chrome-controller.evidence.v1';
  lastConfirmedState: 'COMMITTED' | 'DISPATCHING' | 'RESERVED' | 'UNKNOWN';
  verifiedEvidenceHash?: string;
  failClosed: boolean;
}

export interface EvidenceWorkerState {
  id: WorkerId;
  enabled: boolean;
  status: string;
  blocked: boolean;
  lastHeartbeat?: { at: string; url?: string; windowId?: number; uiBusy?: boolean | null; uiPhase?: string; composerReady?: boolean; sendReady?: boolean; stopVisible?: boolean; scrollToBottomVisible?: boolean; securityBlock?: string | null; modelProfileStatus?: string | null; modelName?: string | null; reasoningEffort?: string | null; modelReady?: boolean | null; modelExact?: boolean | null; verifiedAt?: string | null; blockedReason?: string | null; display?: { workArea?: WorkArea } };
  lastError?: string;
  windowState?: 'OPEN' | 'CLOSED';
  manualCloseSuppressed?: boolean;
}

export interface RuntimeEvidenceInput {
  config: ControllerConfig;
  workArea?: WorkArea;
  workers: EvidenceWorkerState[];
  jobs: UiJobRecord[];
  autopilot: DurableAutopilotState;
  snapshot?: ExternalAutopilotSnapshot;
  paused: boolean;
  killed: boolean;
  recoveryAttempts: Partial<Record<WorkerId, number>>;
  startupReady: boolean;
  interactiveSession?: boolean;
  sessionName?: string | null;
}

export interface AtomicJsonFileOps {
  write(path:string, content:string):void;
  rename(from:string, to:string):void;
  exists(path:string):boolean;
  unlink(path:string):void;
  sleep(ms:number):void;
  tempId():string;
  acquireLock?(path:string):()=>void;
  copy?(from:string,to:string):void;
  read?(path:string):string;
}

function nativeSleep(ms:number){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}
function acquireNativeAtomicJsonLock(path:string){
  const lockPath=`${path}.write.lock`;
  for(let attempt=0;attempt<=8;attempt++){
    try{
      const fd=openSync(lockPath,'wx');
      try{writeFileSync(fd,JSON.stringify({pid:process.pid,acquiredAt:new Date().toISOString()}),'utf8');}finally{closeSync(fd);}
      return ()=>{try{unlinkSync(lockPath);}catch{}};
    }catch(error){
      const code=atomicJsonErrorCode(error);
      if(code==='EEXIST'){
        try{if(Date.now()-statSync(lockPath).mtimeMs>30_000){unlinkSync(lockPath);continue;}}catch{}
      }
      if(!['EEXIST','EPERM','EBUSY'].includes(code)||attempt>=8)throw error;
      nativeSleep(Math.min(500,25*(2**attempt)));
    }
  }
  throw new Error('ATOMIC_JSON_LOCK_EXHAUSTED');
}

const defaultAtomicJsonFileOps:AtomicJsonFileOps = {
  write:(path,content)=>writeFileSync(path,content,'utf8'),
  rename:(from,to)=>renameSync(from,to),
  exists:(path)=>existsSync(path),
  unlink:(path)=>unlinkSync(path),
  sleep:nativeSleep,
  tempId:()=>randomUUID(),
  acquireLock:acquireNativeAtomicJsonLock,
  copy:(from,to)=>copyFileSync(from,to),
  read:(path)=>readFileSync(path,'utf8'),
};

function atomicJsonErrorCode(error:unknown){
  return error instanceof Error&&'code' in error?String((error as NodeJS.ErrnoException).code??''):'';
}

export function atomicWriteJsonWithRetry(path:string,value:unknown,ops:AtomicJsonFileOps=defaultAtomicJsonFileOps,maxRetries=8){
  const release=ops.acquireLock?.(path);
  const temp=`${path}.${process.pid}.${ops.tempId()}.tmp`;
  try{
    ops.write(temp,`${JSON.stringify(value,null,2)}\n`);
    for(let attempt=0;;attempt++){
      try{ops.rename(temp,path);return;}
      catch(error){
        const code=atomicJsonErrorCode(error);
        if(!['EPERM','EBUSY'].includes(code)||attempt>=maxRetries)throw error;
        ops.sleep(Math.min(500,25*(2**attempt)));
      }
    }
  }finally{
    if(ops.exists(temp)){try{ops.unlink(temp);}catch{}}
    release?.();
  }
}

export function persistRuntimeEvidenceJson(path:string,value:unknown,ops:AtomicJsonFileOps=defaultAtomicJsonFileOps){
  try{
    atomicWriteJsonWithRetry(path,value,ops);
    return {mode:'ATOMIC' as const};
  }catch(error){
    const code=atomicJsonErrorCode(error);
    if(!['EPERM','EBUSY'].includes(code)||!ops.copy||!ops.read)throw error;
    const content=`${JSON.stringify(value,null,2)}\n`;
    const lastGood=`${path}.last-good`;
    const temp=`${path}.${process.pid}.${ops.tempId()}.fallback.tmp`;
    if(ops.exists(path))ops.copy(path,lastGood);
    try{
      ops.write(temp,content);
      ops.copy(temp,path);
      if(ops.read(path)!==content)throw new Error('RUNTIME_EVIDENCE_FALLBACK_VERIFY_FAILED');
      return {mode:'COPY_FALLBACK' as const,code};
    }finally{
      if(ops.exists(temp)){try{ops.unlink(temp);}catch{}}
    }
  }
}

export function buildRuntimeEvidence(input: RuntimeEvidenceInput, now = new Date()) {
  const usableWorkArea = input.workArea && workAreaFitsLayout(input.config, input.workArea) ? input.workArea : undefined;
  const placements = computePlacements(input.config, usableWorkArea);
  const nv02 = input.workers.find((worker) => worker.id === 'NV02');
  const nv02Heartbeat = nv02?.lastHeartbeat;
  const modelExact = nv02Heartbeat?.modelProfileStatus === 'MODEL_PROFILE_VERIFIED'
    && nv02Heartbeat?.modelName === 'GPT-5.6 Sol'
    && nv02Heartbeat?.reasoningEffort === 'High'
    && nv02Heartbeat?.modelReady === true;
  return {
    modelVerification: {
      exact: modelExact,
      modelProfileStatus: nv02Heartbeat?.modelProfileStatus ?? 'MODEL_PROFILE_UNKNOWN',
      modelName: nv02Heartbeat?.modelName ?? null,
      reasoningEffort: nv02Heartbeat?.reasoningEffort ?? null,
      modelReady: nv02Heartbeat?.modelReady ?? false,
      verifiedAt: modelExact ? nv02Heartbeat?.verifiedAt ?? null : null,
      blockedReason: modelExact ? null : nv02Heartbeat?.blockedReason ?? 'MODEL_PROFILE_NOT_VERIFIED',
    },

    schemaVersion: 'tigeriq.chrome-controller.runtime-evidence.v2',
    generatedAt: now.toISOString(),
    ownerInteractionMode: input.paused ? 'READ_ONLY' : 'AUTOMATION',
    layout: {
      order: [...WORKER_IDS],
      width: input.config.layout.width,
      height: input.config.layout.height,
      gap: input.config.layout.gap,
      rightMargin: input.config.layout.rightMargin,
      rightAnchored: true,
      ownerWorkspace: { workerRegion:'TOP_RIGHT', reservedBelowY: input.config.layout.top + input.config.layout.height, overlapByDesign:false },
      source: usableWorkArea ? 'HEARTBEAT_WORK_AREA' : 'CONFIG_FALLBACK',
      workArea: usableWorkArea ?? null,
      placements: placements as Record<WorkerId, WindowPlacement>,
    },
    queue: {
      globalUiConcurrency: 1,
      minUiActionGapMs: input.config.pacing.minUiActionGapMs,
      launchGapMs: input.config.pacing.betweenWorkerLaunchMs,
      retryBackoffMs: input.config.pacing.retryBackoffMs,
      maxRetries: input.config.pacing.maxRetries,
    },
    autopilot: {
      enabled: input.config.autopilot.enabled,
      fixedTrigger: 'AUTO_CONTINUE',
      browserAction: 'DISPATCH',
      aiOutputParsed: false,
      completionAwareUiState: true,
      utf8JsonDispatch: true,
      phase: input.autopilot.phase,
      lastDispatchedJobId: input.autopilot.lastDispatchedJobId ?? null,
      lastCompletedJobId: input.autopilot.lastCompletedJobId ?? null,
      lastEvidenceRef: input.autopilot.lastEvidenceRef ?? null,
      pendingJobId: input.autopilot.pendingJobId ?? null,
      uncertainJobId: input.autopilot.uncertainJobId ?? null,
      dispatchFailureClass: input.autopilot.dispatchFailureClass ?? null,
      retryAt: input.autopilot.retryAt ?? null,
      externalSnapshot: input.snapshot ? {
        source: input.snapshot.source,
        observedAt: input.snapshot.observedAt,
        revision: input.snapshot.revision ?? null,
        previousJobId: input.snapshot.previousJob?.jobId ?? null,
        previousJobStatus: input.snapshot.previousJob?.status ?? null,
        nextJobId: input.snapshot.nextJob?.jobId ?? null,
        nextJobStatus: input.snapshot.nextJob?.status ?? null,
        requiredWorkers: input.snapshot.requiredWorkers ?? [],
      } : null,
    },
    recovery: {
      startupReady: input.startupReady,
      heartbeatStaleMs: input.config.recovery.heartbeatStaleMs,
      checkIntervalMs: input.config.recovery.checkIntervalMs,
      maxReopenAttempts: input.config.recovery.maxReopenAttempts,
      startupAttachGraceMs: input.config.recovery.startupAttachGraceMs,
      attempts: input.recoveryAttempts,
    },
    sessionPolicy: {
      chromeVisibleOnly: true,
      interactiveSession: input.interactiveSession ?? null,
      sessionName: input.sessionName ?? null,
      hiddenChromeAllowed: false,
      ownerReadOnlyStopsUiMutation: true,
    },
    security: {
      stopOn: ['BLOCKED_CAPTCHA','BLOCKED_RATE_LIMIT','BLOCKED_SUSPICIOUS_ACTIVITY','BLOCKED_REAUTH','BLOCKED_SECURITY_WARNING'],
      stealth: false,
      fakeHuman: false,
      credentialExtraction: false,
    },
    jobs: input.jobs.map((job) => ({
      jobId: job.jobId,
      workerId: job.workerId,
      issueRef: job.issueRef,
      title: job.title,
      source: job.source,
      stage: job.stage,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      lastActivityAt: job.lastActivityAt,
      completedAt: job.completedAt,
      nextAction: job.nextAction,
      blocker: job.blocker,
      evidenceRefs: [...job.evidenceRefs],
      result: job.result,
    })),
    workers: input.workers.map((worker) => ({
      id: worker.id,
      enabled: worker.enabled,
      status: worker.status,
      blocked: worker.blocked,
      heartbeatAt: worker.lastHeartbeat?.at ?? null,
      url: worker.lastHeartbeat?.url ?? null,
      windowId: worker.lastHeartbeat?.windowId ?? null,
      uiBusy: worker.lastHeartbeat?.uiBusy ?? null,
      uiPhase: worker.lastHeartbeat?.uiPhase ?? null,
      composerReady: worker.lastHeartbeat?.composerReady ?? null,
      sendReady: worker.lastHeartbeat?.sendReady ?? null,
      stopVisible: worker.lastHeartbeat?.stopVisible ?? null,
      scrollToBottomVisible: worker.lastHeartbeat?.scrollToBottomVisible ?? null,
      securityBlock: worker.lastHeartbeat?.securityBlock ?? null,
      modelProfileStatus: worker.lastHeartbeat?.modelProfileStatus ?? null,
      modelName: worker.lastHeartbeat?.modelName ?? null,
      reasoningEffort: worker.lastHeartbeat?.reasoningEffort ?? null,
      modelReady: worker.lastHeartbeat?.modelReady ?? null,
      modelExact: worker.lastHeartbeat?.modelExact ?? null,
      verifiedAt: worker.lastHeartbeat?.verifiedAt ?? null,
      blockedReason: worker.lastHeartbeat?.blockedReason ?? null,
      windowState: worker.windowState ?? null,
      manualCloseSuppressed: worker.manualCloseSuppressed ?? false,
      lastError: worker.lastError ?? null,
    })),
  };
}
