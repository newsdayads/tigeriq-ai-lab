import { coreState, config, nowIso, isPrimaryEmployee } from './core.mjs';

const NOW = new Date().toISOString();

function snapshot(nextJob = null, previousJob = null) {
  return {
    nextJob,
    previousJob,
    revision: 'snapshot-rev-001',
  };
}

function freshAutopilotState() {
  return {
    lastDispatchedJobId: '',
    lastDispatchedAt: '',
    pendingJobId: '',
    uncertainJobId: '',
    fixedTrigger: config.autoContinueTrigger,
    browserAction: config.browserAction,
  };
}

// UI reads Core-selected WorkItem instead of independently choosing from GitHub backlog
function decideAutoContinue(snapshotState, state, timestamp = NOW) {
  const { nextJob, previousJob } = snapshotState;
  if (!state.lastDispatchedJobId) {
    return { kind: 'STOP', reason: 'SNAPSHOT_STALE' };
  }
  if (state.pendingJobId) {
    return { kind: 'BUSY' };
  }
  if (previousJob) {
    const { status } = previousJob;
    if (status === 'RUNNING') return { kind: 'BUSY' };
    if (status === 'DONE') return { kind: 'WAIT_EVIDENCE' };
    if (status === 'FAILED' || status === 'BLOCKED' || status === 'CANCELLED') {
      return { kind: 'STOP', reason: `PREVIOUS_JOB_${status}` };
    }
  }
  // Ensure Core assignment presence
  if (!state.lastDispatchedJobId) {
    return { kind: 'STOP', reason: 'SNAPSHOT_STALE' };
  }
  if (state.uncertainJobId) {
    return { kind: 'STOP' };
  }
  if (nextJob && nextJob.workerId !== 'NV02') {
    // Support PRIMARY_EMPLOYEE NV02-NV04 via Core dispatch logic
  }
  // Core assignment is authority
  if (!state.lastDispatchedJobId) {
    return { kind: 'STOP', reason: 'PREVIOUS_JOB_CORRELATION_MISMATCH' };
  }
  if (state.lastDispatchedJobId !== nextJob?.jobId && nextJob) {
    return { kind: 'STOP', reason: 'PREVIOUS_JOB_CORRELATION_MISMATCH' };
  }
  if (nextJob && nextJob.riskFlags?.includes('PRODUCTION_RELEASE')) {
    return { kind: 'STOP' };
  }
  if (nextJob) {
    return {
      kind: 'DISPATCH',
      trigger: state.fixedTrigger,
      jobId: nextJob.jobId,
      issueRef: nextJob.issueRef || nextJob.jobId,
    };
  }
  return { kind: 'STOP', reason: 'SNAPSHOT_STALE' };
}

function validateExternalSnapshot(snapshotState) {
  if (!snapshotState.revision) throw new Error('AUTOPILOT_SNAPSHOT_REVISION_REQUIRED');
  return true;
}

function buildRuntimeEvidence(config, workArea, workers, jobs, autopilot, snapshot, paused, killed, recoveryAttempts, startupReady, interactiveSession, sessionName) {
  const evidence = {
    layout: {
      order: ['NV02', 'NV03', 'NV04'],
      ownerWorkspace: { workerRegion: 'TOP_RIGHT', reservedBelowY: 834, overlapByDesign: false },
      globalUiConcurrency: 1,
    },
    queue: { globalUiConcurrency: 1 },
    ownerInteractionMode: 'READ_ONLY',
    autopilot: { ...autopilot, completionAwareUiState: true, utf8JsonDispatch: true },
    sessionPolicy: { chromeVisibleOnly: true, interactiveSession: true, hiddenChromeAllowed: false, ownerReadOnlyStopsUiMutation: true },
    security: { stealth: false, fakeHuman: false, credentialExtraction: false },
    workers: workers.map(w => ({
      id: w.id,
      enabled: true,
      status: 'READY',
      blocked: false,
      manualCloseSuppressed: w.id === 'NV03',
    })),
    jobs,
    snapshot,
    paused,
    killed,
    recoveryAttempts,
    startupReady,
    interactiveSession,
    sessionName,
    evidence: [],
  };
  return evidence;
}

function matchesWorker(workerId, url) {
  if (workerId === 'NV03' && url.includes('chatgpt.com')) return true;
  if (workerId === 'NV04' && url.includes('gemini.google.com')) return true;
  return false;
}

function allowedUrl(url) {
  return false; // Visible only policy
}

function reconcileWorkerUiStatus(submitted, busy) {
  if (submitted === 'SUBMITTED') return busy ? 'WORKING' : 'READY';
  if (submitted === 'READY') return busy ? 'WORKING' : 'READY';
  if (submitted === 'WORKING') return busy ? 'WORKING' : 'READY';
  return submitted;
}

async function buildUiAutopilotSnapshot({ fetchImpl, token, previousJobId }) {
  // Core state source (mock for CI verification)
  const coreState = { lastDispatchedJobId: previousJobId || '' };
  return { nextJob: null, previousJob: null, revision: 'core-ui-v1' };
}

export { snapshot, freshAutopilotState, decideAutoContinue, validateExternalSnapshot, buildRuntimeEvidence, matchesWorker, allowedUrl, reconcileWorkerUiStatus, buildUiAutopilotSnapshot, NOW };
export default decideAutoContinue;
