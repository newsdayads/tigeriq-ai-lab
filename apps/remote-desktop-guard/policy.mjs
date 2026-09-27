import { createHash } from 'node:crypto';
import path from 'node:path';

export const MAX_OWNER_LEASE_MS = 5 * 60 * 1000;
export const DEFAULT_LEASE_PATH = 'D:\\TigerIQ\\Runtime\\desktop-commander-remote\\guard\\owner-lease.json';
export const AUTHORIZATION_TOOL = 'tigeriq_authorize_mutation';
// SECURITY BOUNDARY: this policy is evaluated only for calls that traverse Remote Desktop Commander.
// Employee/workforce authorization for native local, API, or GitHub execution belongs to the TigerIQ
// assignment/capability/resource policy and MUST NOT be inferred from or gated by this module.

export const READ_ONLY_TOOLS = Object.freeze([
  'get_config','read_file','read_multiple_files','list_directory','start_search',
  'get_more_search_results','stop_search','list_searches','get_file_info',
  'list_sessions','list_processes','get_usage_stats','read_process_output','ping','who_am_i'
]);

export const MUTATION_TOOLS = Object.freeze([
  'set_config_value','write_file','write_pdf','create_directory','move_file',
  'edit_block','start_process','interact_with_process','force_terminate',
  'kill_process','give_feedback_to_desktop_commander','get_prompts','track_ui_event','shutdown'
]);

export const OBSERVATION_DIRECTORIES = Object.freeze([
  'D:\\TigerIQ'
]);

export const SAFE_TIGERIQ_OPERATION_TOOLS = Object.freeze([
  'write_file','create_directory','move_file','edit_block','start_process'
]);

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function argsHash(args = {}) {
  return createHash('sha256').update(canonical(args)).digest('hex');
}

export function classifyTool(tool) {
  if (READ_ONLY_TOOLS.includes(tool)) return 'READ_ONLY';
  if (MUTATION_TOOLS.includes(tool)) return 'MUTATION';
  return 'UNKNOWN';
}

function normalizeWindowsPath(value) {
  if (typeof value !== 'string' || !path.win32.isAbsolute(value)) return null;
  return path.win32.normalize(value).replace(/[\\/]+$/,'').toLowerCase();
}

const TIGERIQ_ROOT = normalizeWindowsPath('D:\\TigerIQ');
const TIGERIQ_SECRETS_ROOT = normalizeWindowsPath('D:\\TigerIQ\\Secrets');

export function isSensitiveTigerIqPath(value) {
  const candidate = normalizeWindowsPath(value);
  return Boolean(candidate && (
    candidate === TIGERIQ_SECRETS_ROOT ||
    candidate.startsWith(TIGERIQ_SECRETS_ROOT + '\\')
  ));
}

export function isObservationPathAllowed(value) {
  const candidate = normalizeWindowsPath(value);
  if (!candidate || isSensitiveTigerIqPath(candidate)) return false;
  return candidate === TIGERIQ_ROOT || candidate.startsWith(TIGERIQ_ROOT + '\\');
}

export function readScopeAllowed(tool,args = {}) {
  if (tool === 'read_file') return args.isUrl !== true && isObservationPathAllowed(args.path);
  if (tool === 'read_multiple_files') return Array.isArray(args.paths) && args.paths.length > 0 && args.paths.every(isObservationPathAllowed);
  if (tool === 'list_directory' || tool === 'start_search' || tool === 'get_file_info') return isObservationPathAllowed(args.path);
  return true;
}

export function requiredRiskClass(tool,args = {}) {
  const text = canonical(args).toLowerCase();
  if (/credential|password|secret|token|api[-_ ]?key|gh\s+auth|vercel\s+env/.test(text)) return 'CREDENTIAL';
  if (/firewall|permission|\bacl\b|set-acl|icacls|takeown|netsh|executionpolicy|defender|security|remote-desktop-guard/.test(text)) return 'SECURITY_PERMISSION';
  if (/vercel[^\n]{0,160}(--prod|deploy\s+--prod|remove)|\bproduction\b/.test(text)) return 'PRODUCTION';
  if (/billing|payment|purchase|checkout|invoice|credit.?card|stripe|paypal|\bpayg\b/.test(text)) return 'PAID_FINANCIAL';
  if (/\b(del|erase|rm|rmdir|remove-item|format|diskpart|shutdown|reboot|taskkill)\b|--force/.test(text)) return 'DESTRUCTIVE';
  if (/git\s+(push|commit|reset|clean|checkout|switch|merge|rebase|tag)|\.git[\\/]/.test(text)) return 'SOURCE_MUTATION';
  return 'STANDARD';
}

function mutationPaths(tool,args={}) {
  if (['write_file','edit_block','create_directory'].includes(tool)) return [args.path].filter(Boolean);
  if (tool === 'move_file') return [args.source,args.destination,args.source_path,args.destination_path].filter(Boolean);
  return [];
}

export function isSafeTigerIqOperation(tool,args={}) {
  if (!SAFE_TIGERIQ_OPERATION_TOOLS.includes(tool)) return false;
  if (requiredRiskClass(tool,args) !== 'STANDARD') return false;
  if (tool === 'start_process') {
    const text = canonical(args).toLowerCase();
    if (!text.includes('tigeriq')) return false;
    return /(get-process|get-service|get-nettcpconnection|get-childitem|test-path|schtasks\s+\/(query|run|end)|start-service|restart-service|start-process|\bnode(?:\.exe)?\b|\bnpm(?:\.cmd)?\b)/.test(text);
  }
  const paths = mutationPaths(tool,args);
  return paths.length > 0 && paths.every(isObservationPathAllowed);
}

export function validateLeaseEnvelope(lease,{now=Date.now()}={}) {
  if (!lease || lease.version !== 1 || lease.ownerAuthorized !== true) return {ok:false,reason:'OWNER_AUTH_REQUIRED'};
  if (!lease.leaseId || typeof lease.leaseId !== 'string') return {ok:false,reason:'LEASE_ID_REQUIRED'};
  if (typeof lease.authorizationUrl !== 'string' || !/^https:\/\/api\.github\.com\/repos\/newsdayads\/tigeriq-ai-lab\/issues\/comments\/\d+$/.test(lease.authorizationUrl)) {
    return {ok:false,reason:'OWNER_AUTH_REF_INVALID'};
  }
  const issuedAt=Date.parse(lease.issuedAt);
  const expiresAt=Date.parse(lease.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return {ok:false,reason:'LEASE_TIME_INVALID'};
  if (expiresAt <= issuedAt || expiresAt-issuedAt > MAX_OWNER_LEASE_MS) return {ok:false,reason:'LEASE_BOUNDS_INVALID'};
  if (now < issuedAt || now >= expiresAt) return {ok:false,reason:'LEASE_EXPIRED_OR_NOT_ACTIVE'};
  if (classifyTool(lease.tool) !== 'MUTATION' || lease.tool === 'set_config_value') return {ok:false,reason:'LEASE_TOOL_NOT_ALLOWED'};
  if (!['STANDARD','PRODUCTION','CREDENTIAL','SECURITY_PERMISSION','PAID_FINANCIAL','SOURCE_MUTATION','DESTRUCTIVE'].includes(lease.riskClass)) return {ok:false,reason:'LEASE_RISK_CLASS_INVALID'};
  if (!/^[a-f0-9]{64}$/.test(String(lease.argsSha256||''))) return {ok:false,reason:'LEASE_ARGS_HASH_INVALID'};
  return {ok:true,reason:'LEASE_ENVELOPE_VALID'};
}

export function validateOwnerLease({lease,tool,args={},now=Date.now()}={}) {
  const envelope=validateLeaseEnvelope(lease,{now});
  if (!envelope.ok) return envelope;
  if (lease.tool !== tool) return {ok:false,reason:'LEASE_TOOL_SCOPE_MISMATCH'};
  if (lease.argsSha256 !== argsHash(args)) return {ok:false,reason:'LEASE_ARGUMENT_SCOPE_MISMATCH'};
  if (lease.riskClass !== requiredRiskClass(tool,args)) return {ok:false,reason:'LEASE_RISK_SCOPE_MISMATCH'};
  return {ok:true,reason:'OWNER_LEASE_VALID'};
}

export function authorizeRemoteCall({tool,args={},lease,now=Date.now()}={}) {
  // Deliberately actor-agnostic: no employee/model identity can bypass the remote-entry boundary.
  const kind=classifyTool(tool);
  if (kind === 'READ_ONLY') {
    return readScopeAllowed(tool,args)
      ? {ok:true,reason:'READ_ONLY_DEFAULT_PASS'}
      : {ok:false,reason:'READ_SCOPE_DENIED'};
  }
  if (kind !== 'MUTATION') return {ok:false,reason:'UNKNOWN_TOOL_FAIL_CLOSED'};
  if (tool === 'set_config_value') return {ok:false,reason:'REMOTE_CONFIG_MUTATION_FORBIDDEN'};
  if (isSafeTigerIqOperation(tool,args)) return {ok:true,reason:'SAFE_TIGERIQ_OPERATION_PASS'};
  return validateOwnerLease({lease,tool,args,now});
}
