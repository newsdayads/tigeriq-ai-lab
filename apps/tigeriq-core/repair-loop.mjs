import { runExecutionPreflight } from './execution-preflight.mjs';

/**
 * Unified repair decisions.
 */
export const RepairDecision = Object.freeze({
  RETRY: 'RETRY',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
});

/**
 * RepairLoop handles failure signals, retries, and invokes downstream lanes.
 */
class RepairLoop {
  /**
   * @param {number} maxRetries Maximum retry attempts per failure identity.
   */
  constructor(maxRetries = 3) {
    this.maxRetries = maxRetries;
    /** @type {Map<string,number>} */
    this.retryCounts = new Map();
  }

  /**
   * Normalizes raw failure signals into a RepairDecision.
   * @param {string} signal Raw failure identifier.
   * @returns {string} One of RepairDecision values.
   */
  normalize(signal) {
    switch (signal) {
      case 'FAIL':
      case 'CI_FAIL':
        return RepairDecision.RETRY;
      case 'REVIEW_CHANGES':
        return RepairDecision.REVIEW;
      case 'STALL':
        return RepairDecision.BLOCK;
      default:
        return RepairDecision.BLOCK;
    }
  }

  /**
   * Handles a failure, performing retries if allowed.
   * @param {any} failure Raw failure object or string.
   * @returns {Promise<string>} Decision from RepairDecision.
   */
  async handleFailure(failure) {
    const rawSignal = typeof failure === 'string' ? failure : failure?.identity || failure?.type || String(failure);
    const decision = this.normalize(rawSignal);

    if (decision === RepairDecision.RETRY) {
      const count = (this.retryCounts.get(rawSignal) || 0) + 1;
      this.retryCounts.set(rawSignal, count);

      if (count <= this.maxRetries) {
        try {
          // Dynamically import to avoid circular dependencies.
          const { runCodingLane } = await import('../tigeriq-coding-lane/coding-lane.mjs');
          await runCodingLane();
          await runExecutionPreflight({ state: { status: 'running' } });
        } catch (e) {
          // If the lane itself fails, we still propagate the retry decision.
          console.error(JSON.stringify({ event: 'REPAIR_LOOP_LANE_ERROR', error: String(e?.message || e) }));
        }
        return RepairDecision.RETRY;
      }
      // Exhausted retries.
      return RepairDecision.BLOCK;
    }

    // REVIEW or immediate BLOCK decisions.
    return decision;
  }
}

export const repairLoop = new RepairLoop();
