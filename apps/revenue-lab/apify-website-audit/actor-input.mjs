// Zero-cost Actor entry contract: never replace absent user input with a
// different website or echo URL credentials/query parameters into Actor logs.
import { AuditError } from './audit-engine.mjs';

export function requireActorAuditUrl(input) {
  const value = input?.url;
  if (typeof value !== 'string' || !value.trim()) {
    throw new AuditError('INVALID_URL', 'A website URL is required.');
  }
  return value;
}

export function auditStartLogMessage() {
  return 'Starting website audit (target URL omitted from logs).';
}

const KNOWN_AUDIT_FAILURE_CODES = new Set([
  'INVALID_URL', 'UNSUPPORTED_PROTOCOL', 'CREDENTIALS_REJECTED',
  'PRIVATE_TARGET', 'DNS_FAILURE', 'TIMEOUT', 'NON_2XX',
  'UNSUPPORTED_CONTENT_TYPE', 'OVERSIZED_RESPONSE', 'NETWORK_FAILURE',
  'TOO_MANY_REDIRECTS', 'AUDIT_FAILURE',
]);

// Errors from HTTP, DNS, or dependencies may contain user-supplied signed URLs.
// Never interpolate error.message, error.detail, or untrusted error.code into
// Apify's potentially shared execution logs.
export function auditFailureCode(error) {
  return error instanceof AuditError && KNOWN_AUDIT_FAILURE_CODES.has(error.code)
    ? error.code : 'AUDIT_FAILURE';
}

export function auditFailureLogMessage(error) {
  return `Audit failed [${auditFailureCode(error)}].`;
}


// Persist only stable, non-sensitive failure evidence. Network exceptions,
// rejected input URLs and dependency details can contain bearer-like query
// parameters, passwords or signed links. The original URL and exception
// message/detail must never be serialized to Apify's OUTPUT record.
export function auditFailureOutput(error) {
  const code = auditFailureCode(error);
  return {
    schemaVersion: '1.0',
    status: 'failed',
    requestedUrl: null,
    error: {
      code,
      message: auditFailureLogMessage(error),
      detail: null,
    },
    metrics: {
      externalApiCostUSD: 0,
      platformCostUSD: null,
      platformCostStatus: 'pending_private_apify_run',
    },
  };
}
