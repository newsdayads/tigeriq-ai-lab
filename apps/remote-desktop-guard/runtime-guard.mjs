import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REMOTE_GUARD_ENV = 'TIGERIQ_REMOTE_GUARD';
export const MAX_OWNER_LEASE_MS = 5 * 60 * 1000;
export const DEFAULT_LEASE_PATH = 'D:\\TigerIQ\\Runtime\\desktop-commander-remote\\guard\\owner-lease.json';

export const OBSERVATION_DIRECTORIES = Object.freeze([
  'D:\\TigerIQ\\Apps\\ChromeController\\Runtime',
  'D:\\TigerIQ\\Evidence',
  'D:\\TigerIQ\\Logs',
  'D:\\TigerIQ\\Checkpoints',
]);

export const READ_ONLY_TOOLS = Object.freeze([
  'get_config',
  'read_file',
  'read_multiple_files',
  'list_directory',
  'start_search',
  'stop_search',
  'get_file_info',
  'list_sessions',
  'list_processes',
  'get_usage_stats',
  'ping',
  'who_am_i',
]);

export const MUTATION_TOOLS = Object.freeze([
  'set_config_value',
  'write_file',
  'write_pdf',
  'create_directory',
  'move_file',
  'edit_block',
  'start_process',
  'interact_with_process',
  'force_terminate',
  'kill_process',
  'give_feedback_to_desktop_commander',
  'get_prompts',
  'track_ui_event',
  'get_more_search_results',
  'list_searches',
  'get_recent_tool_calls',
  'shutdown',
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

function normalizeWindowsPath(value) {
  if (typeof value !== 'string' || !path.win32.isAbsolute(value)) return null;
  return path.win32.normalize(value).replace(/[\\/]+$/g, '').toLowerCase();
}

function isAllowedObservationPath(value) {
  const target = normalizeWindowsPath(value);
  return OBSERVATION_DIRECTORIES.some((base) => {
    const root = normalizeWindowsPath(base);
    return target === root || target.startsWith(root + '\\');
  });
}

export function validateReadScope(tool, args = {}) {
  if (tool === 'read_file') {
    if (args.isUrl) return { ok:false, reason:'REMOTE_URL_READ_DENIED' };
    return isAllowedObservationPath(args.path) ? { ok:true } : { ok:false, reason:'READ_PATH_OUTSIDE_OBSERVATION_SCOPE' };
  }
  if (tool === 'read_multiple_files') {
    return Array.isArray(args.paths) && args.paths.length > 0 && args.paths.every(isAllowedObservationPath)
      ? { ok:true } : { ok:false, reason:'READ_PATH_OUTSIDE_OBSERVATION_SCOPE' };
  }
  if (['list_directory','start_search','get_file_info'].includes(tool)) {
    return isAllowedObservationPath(args.path) ? { ok:true } : { ok:false, reason:'READ_PATH_OUTSIDE_OBSERVATION_SCOPE' };
  }
  return { ok:true };
}

function requiredRiskClass(tool, args = {}) {
  const text = canonical(args).toLowerCase();
  if (/vercel[^\n]{0,120}(--prod|deploy\s+--prod|remove)|production/.test(text)) return 'PRODUCTION';
  if (/credential|password|secret|token|api[-_ ]?key|gh\s+auth|vercel\s+env/.test(text)) return 'CREDENTIAL';
  if (/git\s+(push|commit|reset|clean|checkout|switch|merge|rebase|tag)|\.git[\\/]/.test(text)) return 'SOURCE_MUTATION';
  if (/\b(del|erase|rm|rmdir|remove-item|format|diskpart|shutdown|reboot|taskkill)\b|--force/.test(text)) return 'DESTRUCTIVE';
  return 'STANDARD';
}

export function validateLeaseObject(lease, { tool, args = {}, now = Date.now() } = {}) {
  if (!lease || lease.version !== 1 || lease.ownerAuthorized !== true) return { ok:false, reason:'OWNER_AUTH_REQUIRED' };
  if (!lease.leaseId || typeof lease.leaseId !== 'string') return { ok:false, reason:'LEASE_ID_REQUIRED' };
  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return { ok:false, reason:'LEASE_TIME_INVALID' };
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_OWNER_LEASE_MS) return { ok:false, reason:'LEASE_BOUNDS_INVALID' };
  if (now < issuedAt || now >= expiresAt) return { ok:false, reason:'LEASE_EXPIRED_OR_NOT_ACTIVE' };
  if (lease.tool !== tool) return { ok:false, reason:'LEASE_TOOL_SCOPE_MISMATCH' };
  if (lease.argsSha256 !== argsHash(args)) return { ok:false, reason:'LEASE_ARGUMENT_SCOPE_MISMATCH' };
  if (lease.riskClass !== requiredRiskClass(tool, args)) return { ok:false, reason:'LEASE_RISK_SCOPE_MISMATCH' };
  if (lease.consumed === true) return { ok:false, reason:'LEASE_CONSUMED' };
  return { ok:true, reason:'OWNER_LEASE_VALID' };
}

async function readLease(leasePath) {
  try {
    return JSON.parse(await readFile(leasePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function inspectActiveLease({ leasePath = DEFAULT_LEASE_PATH, now = Date.now() } = {}) {
  const lease = await readLease(leasePath);
  if (!lease) return null;
  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || now < issuedAt || now >= expiresAt || lease.consumed === true) return null;
  return lease;
}

export async function enforceRemoteToolCall({ remote, tool, args = {}, leasePath = DEFAULT_LEASE_PATH, now = Date.now() } = {}) {
  if (!remote) return { ok:true, reason:'LOCAL_INSTANCE_UNCHANGED' };
  if (process.env[REMOTE_GUARD_ENV] !== '1') return { ok:false, reason:'REMOTE_GUARD_ENV_MISSING' };

  if (READ_ONLY_TOOLS.includes(tool)) {
    const scope = validateReadScope(tool, args);
    return scope.ok ? { ok:true, reason:'READ_ONLY_DEFAULT_PASS' } : scope;
  }

  if (!MUTATION_TOOLS.includes(tool)) return { ok:false, reason:'UNKNOWN_TOOL_FAIL_CLOSED' };

  const lease = await readLease(leasePath);
  const decision = validateLeaseObject(lease, { tool, args, now });
  if (!decision.ok) return decision;

  const consumedPath = leasePath + '.consumed-' + lease.leaseId;
  try {
    await rename(leasePath, consumedPath);
  } catch {
    return { ok:false, reason:'LEASE_CONSUME_RACE_OR_MISSING' };
  }
  return { ok:true, reason:'OWNER_LEASE_VALID_CONSUMED', leaseId:lease.leaseId };
}

export async function filterRemoteTools(tools, { remote, leasePath = DEFAULT_LEASE_PATH, now = Date.now() } = {}) {
  if (!remote) return tools;
  if (process.env[REMOTE_GUARD_ENV] !== '1') return [];
  const lease = await inspectActiveLease({ leasePath, now });
  return tools.filter((tool) => READ_ONLY_TOOLS.includes(tool.name) || (lease && tool.name === lease.tool));
}

export async function mintOwnerLease({ tool, args = {}, riskClass = requiredRiskClass(tool, args), ttlMs = 60_000, leasePath = DEFAULT_LEASE_PATH, now = Date.now() } = {}) {
  if (!MUTATION_TOOLS.includes(tool)) throw new Error('LEASE_TOOL_NOT_MUTATION');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_OWNER_LEASE_MS) throw new Error('LEASE_TTL_INVALID');
  const expectedRisk = requiredRiskClass(tool, args);
  if (riskClass !== expectedRisk) throw new Error('LEASE_RISK_CLASS_MISMATCH');
  const existing = await inspectActiveLease({ leasePath, now });
  if (existing) throw new Error('ACTIVE_LEASE_EXISTS');

  const lease = {
    version:1,
    leaseId:randomUUID(),
    ownerAuthorized:true,
    tool,
    argsSha256:argsHash(args),
    riskClass,
    issuedAt:new Date(now).toISOString(),
    expiresAt:new Date(now + ttlMs).toISOString(),
    consumed:false,
  };
  await mkdir(path.dirname(leasePath), { recursive:true });
  await writeFile(leasePath, JSON.stringify(lease, null, 2), { encoding:'utf8', flag:'wx' });
  return lease;
}
