import { describe, expect, it } from 'vitest';
import { evaluateProviderExecution, type ProviderExecutionContext } from '../packages/worker/src/provider-policy.js';

const ready = (): ProviderExecutionContext => ({
  adapter: 'gemini-android-ui',
  taskKind: 'research.prompt',
  prompt: 'Summarize the supplied public research notes.',
  physicalControllerVerified: true,
  realDevicePaired: true,
  heartbeatFresh: true,
  stableSignedWorkerVerified: true,
  accessibilityEnabled: true,
  providerSessionPresent: true,
  providerAutomationAuthorized: true,
});

describe('provider execution policy', () => {
  it('fails closed before physical PC01 evidence', () => {
    const input = ready();
    input.physicalControllerVerified = false;
    expect(evaluateProviderExecution(input)).toMatchObject({ allowed: false, code: 'PC01_NOT_VERIFIED' });
  });

  it('blocks login/2FA and payment or credential mutation paths', () => {
    expect(evaluateProviderExecution({ ...ready(), requiresLoginOr2fa: true })).toMatchObject({
      allowed: false,
      code: 'LOGIN_OR_2FA_REQUIRED',
    });
    expect(evaluateProviderExecution({ ...ready(), requiresPaymentOrCredentialChange: true })).toMatchObject({
      allowed: false,
      code: 'PAYMENT_OR_CREDENTIAL_CHANGE_FORBIDDEN',
    });
  });

  it('allows only a bounded provider-independent research prompt shape', () => {
    expect(evaluateProviderExecution({ ...ready(), taskKind: 'account.login' })).toMatchObject({
      allowed: false,
      code: 'UNSUPPORTED_TASK_KIND',
    });
    expect(evaluateProviderExecution({ ...ready(), prompt: 'x'.repeat(4_001) })).toMatchObject({
      allowed: false,
      code: 'PROMPT_TOO_LARGE',
    });
  });

  it('returns readiness, never execution proof, when every real-device prerequisite is evidenced', () => {
    expect(evaluateProviderExecution(ready())).toEqual({
      allowed: true,
      code: 'READY_FOR_REAL_DEVICE_PROVIDER_TEST',
      reason: 'all provider-policy prerequisites are evidenced; this is readiness only, not execution proof',
    });
  });
});
