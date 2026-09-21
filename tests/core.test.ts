import {describe,it,expect} from 'vitest';
import {runExecutionPreflight} from '../apps/tigeriq-core/execution-preflight.mjs';
import {reconcileStaleObjectives} from '../apps/tigeriq-core/core.mjs';

describe('Core and Preflight integration',()=>{
  it('checks AUTO_UI dependencies and retry counts in preflight',()=>{
    const res = runExecutionPreflight({ state: { status: 'blocked', retryCount: 1, maxRetries: 3, auto_ui_dependencies: ['ui-1'] } });
    expect(res.ok).toBe(true);
    const resExhausted = runExecutionPreflight({ state: { status: 'blocked', retryCount: 3, maxRetries: 3 } });
    expect(resExhausted.ok).toBe(false);
    const resBadDep = runExecutionPreflight({ state: { status: 'active', auto_ui_dependencies: [123] } });
    expect(resBadDep.ok).toBe(false);
  });
});
