import { createGeminiRateController } from '../shared/gemini-rate-control.mjs';

const resourceFailureLedger = new Map();
const providerCooldowns = new Map();

export function recordFailure(resourceId, provider, errorType, detail = {}) {
  if (!resourceFailureLedger.has(resourceId)) {
    resourceFailureLedger.set(resourceId, []);
  }
  const failures = resourceFailureLedger.get(resourceId);
  failures.push({
    timestamp: new Date().toISOString(),
    provider,
    errorType,
    detail
  });
  if (errorType === 'rate_limit') {
    providerCooldowns.set(provider, Date.now() + 60000);
  }
}

export function getFailureLedger() {
  const ledger = {};
  for (const [resId, failures] of resourceFailureLedger.entries()) {
    ledger[resId] = failures;
  }
  return ledger;
}

export function isProviderInCooldown(provider) {
  const until = providerCooldowns.get(provider);
  if (!until) return false;
  if (Date.now() > until) {
    providerCooldowns.delete(provider);
    return false;
  }
  return true;
}

export function classifyAiError(err, res) {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.status || err?.statusCode;
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota')) {
    return 'rate_limit';
  }
  if (msg.includes('timeout') || err?.name === 'AbortError') {
    return 'timeout';
  }
  if (msg.includes('output_contract') || msg.includes('schema') || msg.includes('json') || msg.includes('parse')) {
    return 'output_contract';
  }
  if (msg.includes('unavailable') || status >= 500) {
    return 'provider_unavailable';
  }
  if (msg.includes('code_defect') || msg.includes('syntax')) {
    return 'code_defect';
  }
  return 'other';
}

export function resetFailureLedger() {
  resourceFailureLedger.clear();
  providerCooldowns.clear();
}
