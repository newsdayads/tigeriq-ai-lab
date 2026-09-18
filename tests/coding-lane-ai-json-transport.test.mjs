import {describe,it,expect} from 'vitest';
import { recordFailure, getFailureLedger, isProviderInCooldown, classifyAiError, resetFailureLedger } from '../apps/tigeriq-coding-lane/ai-json-transport.mjs';

describe('AI JSON Transport Failure Ledger and Cooldowns', () => {
  it('classifies error types correctly', () => {
    expect(classifyAiError({ status: 429 })).toBe('rate_limit');
    expect(classifyAiError(new Error('rate limit exceeded'))).toBe('rate_limit');
    expect(classifyAiError(new Error('timeout'))).toBe('timeout');
    expect(classifyAiError(new Error('output_contract error parsing json'))).toBe('output_contract');
    expect(classifyAiError({ status: 503 }))).toBe('provider_unavailable');
  });

  it('records failures and triggers cooldown on 429', () => {
    resetFailureLedger();
    recordFailure('NV11', 'groq', 'rate_limit', { status: 429 });
    const ledger = getFailureLedger();
    expect(ledger.NV11).toHaveLength(1);
    expect(ledger.NV11[0].errorType).toBe('rate_limit');
    expect(isProviderInCooldown('groq')).toBe(true);
  });
});
