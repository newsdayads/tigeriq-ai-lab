export const NV03_SESSION_STATES = Object.freeze({
  HEALTHY_INTERACTIVE: 'HEALTHY_INTERACTIVE',
  WRONG_WINDOWS_SESSION: 'WRONG_WINDOWS_SESSION',
  NOT_RUNNING: 'NOT_RUNNING',
  SCOPE_MISMATCH: 'SCOPE_MISMATCH',
  NO_INTERACTIVE_SESSION: 'NO_INTERACTIVE_SESSION',
});

function validSession(value) {
  return Number.isInteger(value) && value > 0;
}

export function classifyNv03Session(snapshot) {
  const active = Number(snapshot?.activeSessionId);
  if (!validSession(active)) {
    return { state: NV03_SESSION_STATES.NO_INTERACTIVE_SESSION, activeSessionId: active || null };
  }

  const chrome = snapshot?.chrome ?? {};
  const sidecar = snapshot?.sidecar ?? {};
  if ((chrome.listening && chrome.scopeMatched === false) || (sidecar.listening && sidecar.scopeMatched === false)) {
    return { state: NV03_SESSION_STATES.SCOPE_MISMATCH, activeSessionId: active };
  }

  if (!chrome.listening || !sidecar.listening) {
    return { state: NV03_SESSION_STATES.NOT_RUNNING, activeSessionId: active };
  }

  if (Number(chrome.sessionId) !== active || Number(sidecar.sessionId) !== active) {
    return {
      state: NV03_SESSION_STATES.WRONG_WINDOWS_SESSION,
      activeSessionId: active,
      chromeSessionId: Number(chrome.sessionId),
      sidecarSessionId: Number(sidecar.sessionId),
    };
  }

  return {
    state: NV03_SESSION_STATES.HEALTHY_INTERACTIVE,
    activeSessionId: active,
    chromeSessionId: active,
    sidecarSessionId: active,
  };
}

export function planNv03SessionRecovery(snapshot) {
  const classification = classifyNv03Session(snapshot);
  switch (classification.state) {
    case NV03_SESSION_STATES.HEALTHY_INTERACTIVE:
      return { classification, actions: [] };
    case NV03_SESSION_STATES.WRONG_WINDOWS_SESSION:
      return {
        classification,
        actions: [
          'STOP_NV03_SIDECAR_WRONG_SESSION',
          'STOP_NV03_CHROME_WRONG_SESSION',
          'START_NV03_CHROME_INTERACTIVE',
          'START_NV03_SIDECAR_INTERACTIVE',
          'VERIFY_NV03_INTERACTIVE',
        ],
      };
    case NV03_SESSION_STATES.NOT_RUNNING:
      return {
        classification,
        actions: [
          'STOP_NV03_PARTIAL_SCOPED_RUNTIME',
          'START_NV03_CHROME_INTERACTIVE',
          'START_NV03_SIDECAR_INTERACTIVE',
          'VERIFY_NV03_INTERACTIVE',
        ],
      };
    default:
      return { classification, actions: [] };
  }
}
