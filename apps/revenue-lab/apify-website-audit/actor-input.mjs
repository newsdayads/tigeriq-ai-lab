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
