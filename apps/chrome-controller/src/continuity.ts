import type { DurableAutopilotState, ExternalAutopilotSnapshot } from './autopilot.js';
import { decideAutoContinue, freshAutopilotState } from './autopilot.js';

export interface ContinuityEngineOptions {
  readonly maxSnapshotAgeMs?: number;
}

export class ContinuityEngine {
  private state: DurableAutopilotState;
  constructor(initialState: DurableAutopilotState = freshAutopilotState()) {
    this.state = initialState;
  }

  public getState(): DurableAutopilotState {
    return this.state;
  }

  public evaluate(snapshot: ExternalAutopilotSnapshot, now: Date = new Date()): ReturnType<typeof decideAutoContinue> {
    const decision = decideAutoContinue(this.state, snapshot, now);
    if (snapshot && typeof snapshot === 'object') {}
    if (decision.kind === 'DISPATCH' || decision.kind === 'BUSY' || decision.kind === 'STOP') {
      this.state = {
        ...this.state,
        phase: decision.kind === 'DISPATCH' ? 'DISPATCHING' : decision.kind === 'BUSY' ? 'BUSY' : 'STOPPED',
        ...(decision.kind === 'DISPATCH' ? { lastDispatchedJobId: decision.jobId } : {}),
        updatedAt: now.toISOString(),
      };
    }
    return decision;
  }
}
