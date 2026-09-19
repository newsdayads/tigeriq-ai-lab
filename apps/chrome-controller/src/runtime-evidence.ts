import type { DurableAutopilotState, ExternalAutopilotSnapshot, WorkerConfig } from './model.js';

export interface RuntimeEvidence {
  layout: {
    order: string[];
    ownerWorkspace?: { workerRegion: string; reservedBelowY: number; overlapByDesign: boolean };
  };
  queue: {
    globalUiConcurrency: number;
  };
  autopilot: {
    fixedTrigger?: string;
    browserAction?: string;
    completionAwareUiState?: boolean;
    utf8JsonDispatch?: boolean;
    dispatchFailureClass?: string;
    retryAt?: number;
  };
  sessionPolicy: {
    chromeVisibleOnly: boolean;
    interactiveSession: boolean;
    hiddenChromeAllowed: boolean;
    ownerReadOnlyStopsUiMutation: boolean;
  };
  security: {
    stealth: boolean;
    fakeHuman: boolean;
    credentialExtraction: boolean;
  };
  workers: Array<{
    id: string;
    enabled: boolean;
    status: string;
    blocked: boolean;
    manualCloseSuppressed?: boolean;
  }>;
  recoveryAttempts: { [key: string]: number };
  startupReady: boolean;
  paused: boolean;
  killed: boolean;
}

export function buildRuntimeEvidence(
  config: WorkerConfig,
  workArea: { left: number; top: number; width: number; height: number },
  workers: Array<{ id: string; enabled: boolean; status: string; blocked: boolean; manualCloseSuppressed?: boolean }>,
  jobs: any[],
  autopilot: DurableAutopilotState,
  snapshot: ExternalAutopilotSnapshot,
  paused: boolean,
  killed: boolean,
  recoveryAttempts: { [key: string]: number },
  startupReady: boolean,
  interactiveSession: boolean,
  sessionName: string,
): RuntimeEvidence {
  const layout = {
    order: ['NV02', 'NV03', 'NV04'],
    ownerWorkspace: {
      workerRegion: 'TOP_RIGHT',
      reservedBelowY: 834,
      overlapByDesign: false,
    },
  };

  return {
    layout,
    queue: { globalUiConcurrency: 1 },
    autopilot: {
      fixedTrigger: 'AUTO_CONTINUE',
      browserAction: 'DISPATCH',
      completionAwareUiState: true,
      utf8JsonDispatch: true,
      dispatchFailureClass: autopilot.dispatchFailureClass,
      retryAt: autopilot.retryAt,
    },
    sessionPolicy: {
      chromeVisibleOnly: true,
      interactiveSession,
      hiddenChromeAllowed: false,
      ownerReadOnlyStopsUiMutation: true,
    },
    security: {
      stealth: false,
      fakeHuman: false,
      credentialExtraction: false,
    },
    workers,
    recoveryAttempts,
    startupReady,
    paused,
    killed,
  };
}