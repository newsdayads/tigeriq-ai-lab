import { createHash } from 'node:crypto';

export const EXPECTED_PERMISSION_MODE = 'ask_before_writes';
export const MAX_OWNER_LEASE_MS = 15 * 60 * 1000;

export const READ_ONLY_TOOLS = Object.freeze([
  'get_config','read_file','read_multiple_files','list_directory','start_search',
  'get_more_search_results','stop_search','list_searches','get_file_info',
  'list_sessions','list_processes','get_usage_stats','get_recent_tool_calls',
  'read_process_output'
]);

export const MUTATION_TOOLS = Object.freeze([
  'set_config_value','write_file','write_pdf','create_directory','move_file',
  'edit_block','start_process','interact_with_process','force_terminate',
  'kill_process','give_feedback_to_desktop_commander','get_prompts'
]);

export const OBSERVATION_DIRECTORIES = Object.freeze([
  'D:\\TigerIQ\\Apps\\ChromeController\\Runtime',
  'D:\\TigerIQ\\Evidence',
  'D:\\TigerIQ\\Logs',
  'D:\\TigerIQ\\Checkpoints'
]);

export const DEFENSE_IN_DEPTH_BLOCKED_COMMANDS = Object.freeze([
  'powershell','powershell.exe','pwsh','pwsh.exe','cmd','cmd.exe',
  'node','node.exe','node:local','python','python.exe','python3','py','py.exe',
  'git','git.exe','vercel','vercel.exe','vercel.cmd','npm','npm.cmd','npx','npx.cmd',
  'bash','bash.exe','sh','wsl','wsl.exe','curl','curl.exe','wget','certutil',
  'mshta','rundll32','regsvr32','schtasks','taskkill'
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

export function validateOwnerLease({ lease, tool, args = {}, now = Date.now() } = {}) {
  if (!lease || lease.version !== 1 || lease.ownerAuthorized !== true) return { ok:false, reason:'OWNER_AUTH_REQUIRED' };
  if (!lease.leaseId || typeof lease.leaseId !== 'string') return { ok:false, reason:'LEASE_ID_REQUIRED' };
  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return { ok:false, reason:'LEASE_TIME_INVALID' };
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_OWNER_LEASE_MS) return { ok:false, reason:'LEASE_BOUNDS_INVALID' };
  if (now < issuedAt || now >= expiresAt) return { ok:false, reason:'LEASE_EXPIRED_OR_NOT_ACTIVE' };
  if (lease.tool !== tool) return { ok:false, reason:'LEASE_TOOL_SCOPE_MISMATCH' };
  if (lease.argsSha256 !== argsHash(args)) return { ok:false, reason:'LEASE_ARGUMENT_SCOPE_MISMATCH' };
  if (lease.consumed === true) return { ok:false, reason:'LEASE_CONSUMED' };
  return { ok:true, reason:'OWNER_LEASE_VALID', consume:true };
}

export function authorizeRemoteCall({ tool, args = {}, lease, permissionMode = EXPECTED_PERMISSION_MODE, now = Date.now() } = {}) {
  const kind = classifyTool(tool);
  if (kind === 'READ_ONLY') return { ok:true, reason:'READ_ONLY_DEFAULT_PASS' };
  if (kind !== 'MUTATION') return { ok:false, reason:'UNKNOWN_TOOL_FAIL_CLOSED' };
  if (permissionMode !== EXPECTED_PERMISSION_MODE) return { ok:false, reason:'PERMISSION_MODE_FAIL_CLOSED' };
  return validateOwnerLease({ lease, tool, args, now });
}

export function consumeOwnerLease(lease) {
  if (!lease || lease.consumed === true) throw new Error('LEASE_NOT_CONSUMABLE');
  return { ...lease, consumed:true, consumedAt:new Date().toISOString() };
}

export function verifyDesktopCommanderConfig(config = {}) {
  const errors = [];
  if (!Array.isArray(config.allowedDirectories) || config.allowedDirectories.length === 0) errors.push('ALLOWED_DIRECTORIES_MUST_BE_NARROW');
  for (const dir of OBSERVATION_DIRECTORIES) if (!config.allowedDirectories?.includes(dir)) errors.push('MISSING_OBSERVATION_DIR:' + dir);
  if (config.allowedDirectories?.some((dir) => /\\Secrets(?:\\|$)/i.test(dir))) errors.push('SECRETS_DIRECTORY_FORBIDDEN');
  if (config.defaultShell !== '__TIGERIQ_REMOTE_SHELL_DENIED__.exe') errors.push('DEFAULT_SHELL_MUST_DENY');
  for (const cmd of DEFENSE_IN_DEPTH_BLOCKED_COMMANDS) if (!config.blockedCommands?.includes(cmd)) errors.push('MISSING_BLOCKED_COMMAND:' + cmd);
  return { ok:errors.length === 0, errors };
}
