export function classifyError(error) {
  const msg = String(error?.message || error || '');
  if (/HTTP_429|rate_limit/i.test(msg)) return 'rate_limit';
  if (/timeout|aborted|ETIMEDOUT/i.test(msg)) return 'timeout';
  if (/JSON_OBJECT_INVALID|Unterminated|truncat|unexpected non-whitespace/i.test(msg)) return 'output_contract';
  return 'other';
}

export async function withFailover(providerCall, alternatives = [], options = {}) {
  const { maxRetries = 3, onFail = () => {} } = options;
  const providers = [providerCall, ...(alternatives || [])].filter(Boolean);
  let lastError = null;

  for (const [index, provider] of providers.entries()) {
    if (!provider) continue;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await provider();
        return result;
      } catch (error) {
        lastError = error;
        const failureClass = classifyError(error);
        onFail({ error, attempt: attempt + 1, index, providerClass: failureClass });
        if (failureClass === 'output_contract') {
          break; // Permanent for this provider, switch next
        }
        if (failureClass !== 'timeout' && failureClass !== 'rate_limit') {
          break; // Non-transient, switch next
        }
        // Transient (timeout/rate_limit): continue retries on same provider
      }
    }
  }
  throw lastError;
}
