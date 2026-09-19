import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { WORKER_IDS, computePlacements, workAreaFitsLayout, type ControllerConfig, type WindowPlacement, type WorkArea, type WorkerId } from './model.js';
import type { DurableAutopilotState, ExternalAutopilotSnapshot } from './autopilot.js';
import type { UiJobRecord } from './job-ledger.js';

export interface EvidenceWorkerState {
  id: WorkerId;
  enabled: boolean;
  status: string;
  blocked: boolean;
  lastHeartbeat?: { at: string; url?: string; windowId?: number; uiBusy?: boolean | null; securityBlock?: string | null; display?: { workArea?: WorkArea } };
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

export function buildRuntimeEvidence(input: RuntimeEvidenceInput, now = new Date()) {
  const usableWorkArea = input.workArea && workAreaFitsLayout(input.config, input.workArea) ? input.workArea : undefined;
  const placements = computePlacements(input.config, usableWorkArea);
  return {
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
      securityBlock: worker.lastHeartbeat?.securityBlock ?? null,
      windowState: worker.windowState ?? null,
      manualCloseSuppressed: worker.manualCloseSuppressed ?? false,
      lastError: worker.lastError ?? null,
    })),
  };
}

const MAX_RETRIES = 5;
const BACKOFF_MS = 200;

export async function persistEvidence(path: string, evidence: RuntimeEvidenceInput): Promise<void> {
  const backupPath = path + '.bak';
  const tempPath = path + '.tmp';

  try {
    await fs.access(path);
    await fs.rename(path, backupPath);
  } catch {
    // Ignore if no existing file
  }

  let lastErr: Error | undefined;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      await fs.writeFile(tempPath, JSON.stringify(evidence, null, 2), 'utf8');
      await fs.rename(tempPath, path);
      return;
    } catch (err: any) {
      lastErr = err;
      if (['EPERM', 'EBUSY'].includes(err?.code)) {
        const delay = BACKOFF_MS * (i + 1) * (0.5 + Math.random());
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  if (lastErr) {
    try {
      await fs.access(backupPath);
      await fs.rename(backupPath, path);
    } catch {
      // If no backup, we fail closed
    }
    throw lastErr;
  }
}

export async function loadEvidence(path: string): Promise<RuntimeEvidenceInput | undefined> {
  for (const candidate of [path, path + '.bak']) {
    try {
      const buf = await fs.readFile(candidate, 'utf8');
      return JSON.parse(buf);
    } catch {
      continue;
    }
  }
  return undefined;
}