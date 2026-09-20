export interface HeartbeatSecuritySignals {
  authRequired?:boolean;
  reauthRequired?:boolean;
  captchaRequired?:boolean;
  rateLimited?:boolean;
  rateLimitCode?:number|string;
  securityBlock?:string|null;
}

export interface SaveReceiptVerificationInput {
  receipt?: any;
  expectedToken?: string;
  expectedWorker?: string;
  expectedDispatchedAt?: string | number;
  maxAgeMs?: number;
  now?: number;
}

export function verifySaveReceiptV1(input: SaveReceiptVerificationInput): { valid: boolean; reason?: string } {
  const receipt = input.receipt;
  if (!receipt || typeof receipt !== 'object') {
    return { valid: false, reason: 'RECEIPT_MISSING' };
  }
  if (receipt.schemaVersion !== 'tigeriq.chrome-controller.save-receipt.v1' || receipt.type !== 'TIGERIQ_SAVE_RECEIPT_V1') {
    return { valid: false, reason: 'INVALID_SCHEMA_VERSION' };
  }
  if (receipt.status !== 'DURABLE') {
    return { valid: false, reason: 'SAVE_NOT_DURABLE' };
  }
  if (!receipt.token || typeof receipt.token !== 'string') {
    return { valid: false, reason: 'INVALID_TOKEN' };
  }
  if (input.expectedToken && receipt.token !== input.expectedToken) {
    return { valid: false, reason: 'TOKEN_MISMATCH' };
  }
  if (!receipt.workerId || typeof receipt.workerId !== 'string') {
    return { valid: false, reason: 'INVALID_WORKER' };
  }
  if (input.expectedWorker && receipt.workerId !== input.expectedWorker) {
    return { valid: false, reason: 'WORKER_MISMATCH' };
  }
  if (!receipt.dispatchedAt) {
    return { valid: false, reason: 'DISPATCH_TIMESTAMP_MISSING' };
  }
  const dispatchedMs = new Date(receipt.dispatchedAt).getTime();
  if (isNaN(dispatchedMs)) {
    return { valid: false, reason: 'INVALID_DISPATCH_TIMESTAMP' };
  }
  if (input.expectedDispatchedAt) {
    const expectedMs = new Date(input.expectedDispatchedAt).getTime();
    if (!isNaN(expectedMs) && dispatchedMs !== expectedMs) {
      return { valid: false, reason: 'DISPATCH_TIMESTAMP_MISMATCH' };
    }
  }
  if (input.maxAgeMs && input.maxAgeMs > 0) {
    const now = input.now ?? Date.now();
    if (now - dispatchedMs > input.maxAgeMs || dispatchedMs > now + 60000) {
      return { valid: false, reason: 'RECEIPT_STALE' };
    }
  }
  return { valid: true };
}

import { restoreGpt5_6SolProfile } from './model.js';
import { checkModelProfileBlockedAfterReopen } from './runtime-evidence.js';

const restoredReopenFlags = new Set<string>();

export function resetRuntimeRecoveryGuards(): void {
  restoredReopenFlags.clear();
}

export function checkAndRestoreModelProfileAfterReopen(worker: { id: any; windowState?: string; blocked?: boolean; blockedReason?: string | null; lastHeartbeat?: any }, activeWorkItemId?: string, dispatchBridge?: (p: any) => boolean): { restored: boolean; reason?: string } {
  const workerId = worker.id;
  const guardKey = `${workerId}:${worker.windowState ?? 'UNKNOWN'}`;
  if (restoredReopenFlags.has(guardKey)) {
    return { restored: false, reason: 'ALREADY_RESTORED_FOR_REOPEN' };
  }
  
  const isBlocked = checkModelProfileBlockedAfterReopen(worker as any);
  if (!isBlocked) {
    return { restored: false, reason: 'NOT_BLOCKED' };
  }

  restoredReopenFlags.add(guardKey);
  try {
    const res = restoreGpt5_6SolProfile(workerId, activeWorkItemId, dispatchBridge);
    return { restored: res.dispatched, reason: res.dispatched ? 'RESTORED' : 'DISPATCH_FAILED' };
  } catch (err: any) {
    return { restored: false, reason: `RESTORE_ERROR:${err?.message ?? String(err)}` };
  }
}

export function heartbeatStopReason(hb:HeartbeatSecuritySignals|undefined):string|undefined{
  if(!hb)return;
  if(hb.authRequired)return 'AUTH_REQUIRED';
  if(hb.reauthRequired)return 'REAUTH';
  if(hb.captchaRequired)return 'CAPTCHA';
  if(hb.rateLimited||Number(hb.rateLimitCode)===429)return 'RATE_LIMIT_429';
  const raw=String(hb.securityBlock||'').trim().toUpperCase();
  if(!raw)return;
  if(raw.includes('CAPTCHA'))return 'CAPTCHA';
  if(raw.includes('REAUTH')||raw.includes('VERIFY'))return 'REAUTH';
  if(raw.includes('RATE_LIMIT')||raw.includes('429')||raw.includes('TOO_MANY_REQUESTS'))return 'RATE_LIMIT_429';
  if(raw.includes('SUSPICIOUS')||raw.includes('SECURITY'))return raw.startsWith('BLOCKED_')?raw:'SECURITY_WARNING';
  return raw.startsWith('BLOCKED_')?raw:'SECURITY_BLOCK';
}
