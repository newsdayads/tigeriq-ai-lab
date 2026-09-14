import { WORKER_IDS, computePlacements, type ControllerConfig, type WindowPlacement, type WorkArea, type WorkerId } from './model.js';
import type { DurableAutopilotState, ExternalAutopilotSnapshot } from './autopilot.js';

export interface EvidenceWorkerState {
  id: WorkerId;
  enabled: boolean;
  status: string;
  blocked: boolean;
  lastHeartbeat?: { at: string; url?: string; windowId?: number; display?: { workArea?: WorkArea } };
  lastError?: string;
}

export interface RuntimeEvidenceInput {
  config: ControllerConfig;
  workArea?: WorkArea;
  workers: EvidenceWorkerState[];
  autopilot: DurableAutopilotState;
  snapshot?: ExternalAutopilotSnapshot;
  paused: boolean;
  killed: boolean;
  recoveryAttempts: Partial<Record<WorkerId, number>>;
  startupReady: boolean;
}

export function buildRuntimeEvidence(input: RuntimeEvidenceInput, now = new Date()) {
  const placements = computePlacements(input.config, input.workArea);
  return {
    schemaVersion: 'tigeriq.chrome-controller.runtime-evidence.v1',
    generatedAt: now.toISOString(),
    layout: {
      order: [...WORKER_IDS],
      width: input.config.layout.width,
      height: input.config.layout.height,
      gap: input.config.layout.gap,
      rightMargin: input.config.layout.rightMargin,
      rightAnchored: true,
      source: input.workArea ? 'HEARTBEAT_WORK_AREA' : 'CONFIG_FALLBACK',
      workArea: input.workArea ?? null,
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
      aiOutputParsed: false,
      phase: input.autopilot.phase,
      lastDispatchedJobId: input.autopilot.lastDispatchedJobId ?? null,
      lastCompletedJobId: input.autopilot.lastCompletedJobId ?? null,
      lastEvidenceRef: input.autopilot.lastEvidenceRef ?? null,
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
      attempts: input.recoveryAttempts,
    },
    security: {
      stopOn: ['BLOCKED_CAPTCHA','BLOCKED_RATE_LIMIT','BLOCKED_SUSPICIOUS_ACTIVITY','BLOCKED_REAUTH','BLOCKED_SECURITY_WARNING'],
      stealth: false,
      fakeHuman: false,
      credentialExtraction: false,
    },
    workers: input.workers.map((worker) => ({
      id: worker.id,
      enabled: worker.enabled,
      status: worker.status,
      blocked: worker.blocked,
      heartbeatAt: worker.lastHeartbeat?.at ?? null,
      url: worker.lastHeartbeat?.url ?? null,
      windowId: worker.lastHeartbeat?.windowId ?? null,
      lastError: worker.lastError ?? null,
    })),
  };
}
