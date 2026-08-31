export type ProviderAdapter = 'gemini-android-ui';

export type ProviderTaskKind = 'research.prompt';

export interface ProviderExecutionContext {
  adapter: ProviderAdapter;
  taskKind: string;
  prompt: string;
  physicalControllerVerified: boolean;
  realDevicePaired: boolean;
  heartbeatFresh: boolean;
  stableSignedWorkerVerified: boolean;
  accessibilityEnabled: boolean;
  providerSessionPresent: boolean;
  providerAutomationAuthorized: boolean;
  requiresLoginOr2fa?: boolean;
  requiresPaymentOrCredentialChange?: boolean;
}

export interface ProviderPolicyDecision {
  allowed: boolean;
  code:
    | 'READY_FOR_REAL_DEVICE_PROVIDER_TEST'
    | 'UNSUPPORTED_ADAPTER'
    | 'UNSUPPORTED_TASK_KIND'
    | 'EMPTY_PROMPT'
    | 'PROMPT_TOO_LARGE'
    | 'PC01_NOT_VERIFIED'
    | 'DEVICE_NOT_PAIRED'
    | 'HEARTBEAT_STALE'
    | 'STABLE_SIGNING_NOT_VERIFIED'
    | 'ACCESSIBILITY_NOT_ENABLED'
    | 'PROVIDER_SESSION_MISSING'
    | 'PROVIDER_AUTOMATION_NOT_AUTHORIZED'
    | 'LOGIN_OR_2FA_REQUIRED'
    | 'PAYMENT_OR_CREDENTIAL_CHANGE_FORBIDDEN';
  reason: string;
}

const MAX_PROMPT_CHARS = 4_000;

/**
 * Fail-closed policy boundary for consumer-AI Android UI adapters.
 *
 * This function does not execute Gemini or any third-party UI action. It only decides
 * whether a narrowly scoped real-device adapter is eligible to enter a provider test.
 * Live provider success must be established separately by physical execution evidence.
 */
export function evaluateProviderExecution(context: ProviderExecutionContext): ProviderPolicyDecision {
  if (context.adapter !== 'gemini-android-ui') {
    return deny('UNSUPPORTED_ADAPTER', 'provider adapter is not allowlisted');
  }
  if (context.taskKind !== 'research.prompt') {
    return deny('UNSUPPORTED_TASK_KIND', 'only bounded research.prompt tasks are allowlisted');
  }
  if (!context.prompt.trim()) return deny('EMPTY_PROMPT', 'provider prompt is required');
  if (context.prompt.length > MAX_PROMPT_CHARS) {
    return deny('PROMPT_TOO_LARGE', `provider prompt exceeds ${MAX_PROMPT_CHARS} characters`);
  }
  if (context.requiresPaymentOrCredentialChange) {
    return deny('PAYMENT_OR_CREDENTIAL_CHANGE_FORBIDDEN', 'payment and credential mutations are never allowed');
  }
  if (context.requiresLoginOr2fa) {
    return deny('LOGIN_OR_2FA_REQUIRED', 'login or 2FA requires owner-controlled physical authorization');
  }
  if (!context.physicalControllerVerified) {
    return deny('PC01_NOT_VERIFIED', 'real PC01 Controller evidence is required');
  }
  if (!context.realDevicePaired) {
    return deny('DEVICE_NOT_PAIRED', 'real Android pairing evidence is required');
  }
  if (!context.heartbeatFresh) {
    return deny('HEARTBEAT_STALE', 'fresh authenticated heartbeat evidence is required');
  }
  if (!context.stableSignedWorkerVerified) {
    return deny('STABLE_SIGNING_NOT_VERIFIED', 'installed stable-signing continuity is required');
  }
  if (!context.accessibilityEnabled) {
    return deny('ACCESSIBILITY_NOT_ENABLED', 'AccessibilityService must be enabled on the real device');
  }
  if (!context.providerSessionPresent) {
    return deny('PROVIDER_SESSION_MISSING', 'provider session must already exist; automation may not log in');
  }
  if (!context.providerAutomationAuthorized) {
    return deny('PROVIDER_AUTOMATION_NOT_AUTHORIZED', 'provider-specific automation policy is not authorized');
  }
  return {
    allowed: true,
    code: 'READY_FOR_REAL_DEVICE_PROVIDER_TEST',
    reason: 'all provider-policy prerequisites are evidenced; this is readiness only, not execution proof',
  };
}

function deny(code: Exclude<ProviderPolicyDecision['code'], 'READY_FOR_REAL_DEVICE_PROVIDER_TEST'>, reason: string): ProviderPolicyDecision {
  return { allowed: false, code, reason };
}
