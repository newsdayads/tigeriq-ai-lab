import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {branchName,checkGateState,extractCanonicalAllowedPaths,isRetryableAiError,parseJsonObject,safeRepoPath,validateChanges} from './policy.mjs';
import { createGeminiRateController } from '../shared/gemini-rate-control.mjs';
import { recordFailure, getFailureLedger, isProviderInCooldown, classifyAiError, resetFailureLedger } from './ai-json-transport.mjs';

export class CodingScopeViolationError extends Error {
  constructor(offending) {
    super(`CODING_SCOPE_VIOLATION: ${offending.join(', ')}`);
    this.code='CODING_SCOPE_VIOLATION';
    this.offending=offending;
    this.detail={code:'CODING_SCOPE_VIOLATION',offending};
  }
}

export function validateJobScope(jobPaths,changes){
  const allowed=new Set(Array.isArray(jobPaths)?jobPaths:[]);
  const offending=(changes||[]).map(c=>c?.path).filter(Boolean).filter(p=>!allowed.has(p));
  if(offending.length) throw new CodingScopeViolationError(offending);
  return true;
}

export function validateSourceScope(proposedPaths,canonicalPaths){
  const canonical=new Set((canonicalPaths||[]).map(String));
  if(!canonical.size)return true;
  const offending=(proposedPaths||[]).map(String).filter(p=>!canonical.has(p));
  if(offending.length)throw new CodingScopeViolationError(offending);
  return true;
}

export function selectNextAvailableResource(resources, excludedIds = []) {
  const available = resources.filter(r => {
    if (excludedIds.includes(r.id)) return false;
    if (isProviderInCooldown(r.provider)) return false;
    return typeof r.ready === 'function' ? r.ready() : true;
  });
  return available[0] || null;
}

export function handleResourceExhaustion(job, error) {
  const errorType = classifyAiError(error);
  if (errorType === 'output_contract') {
    return { route: 'bootstrap_repair', action: 'route_output_contract_exhaustion_directly_to_repair' };
  }
  return { route: 'waiting_resource', errorType };
}

export { recordFailure, getFailureLedger, isProviderInCooldown, classifyAiError, resetFailureLedger };
