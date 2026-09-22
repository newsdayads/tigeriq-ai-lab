import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const win = path.win32;
export const PC_OPERATOR_ROOTS = Object.freeze([
  'D:\\TigerIQ',
  'D:\\OpenClaw',
  'D:\\TigerIQ-OpenClaw',
]);
const DEFAULT_ROOT = PC_OPERATOR_ROOTS[0];
const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 512 * 1024;
const MAX_OUTPUT_CHARS = 64 * 1024;
const MAX_TIMEOUT_SEC = 120;
const ALLOWED_TCP_HOSTS = new Set(['127.0.0.1', 'localhost', '100.97.23.87']);
const ALLOWED_TCP_PORTS = new Set([8793, 8794, 8795, 8796, 8797, 8798, 8799, 11434, 18789]);

const DENIED_PATH_FRAGMENTS = [
  '\\secrets\\',
  '\\.ssh\\',
  '\\windows\\system32\\config\\',
  '\\appdata\\local\\google\\chrome\\user data\\',
  '\\appdata\\local\\microsoft\\edge\\user data\\',
];

export const PC_WRITE_ROOTS = Object.freeze([
  'D:\\TigerIQ\\State',
  'D:\\TigerIQ\\Evidence',
  'D:\\TigerIQ\\Logs',
  'D:\\TigerIQ-OpenClaw\\state',
]);

const SAFE_SHELL_PATTERNS = [
  /^git\s+status(?:\s+--short|\s+--porcelain(?:=v1)?)?$/i,
  /^git\s+branch\s+--show-current$/i,
  /^git\s+rev-parse\s+(?:HEAD|--show-toplevel|--is-inside-work-tree)$/i,
  /^git\s+log\s+-[1-9]\d?(?:\s+--oneline)?$/i,
  /^git\s+show\s+--stat(?:\s+[0-9a-f]{7,40})?$/i,
  /^ollama\s+(?:list|ps)$/i,
  /^(?:"?D:\\OpenClaw\\npm-global\\openclaw\.cmd"?|openclaw(?:\.cmd)?)\s+--version$/i,
  /^(?:"?D:\\OpenClaw\\npm-global\\openclaw\.cmd"?|openclaw(?:\.cmd)?)\s+plugins\s+(?:list|inspect\s+tigeriq-runtime)(?:\s+--json)?$/i,
  /^(?:"?D:\\OpenClaw\\npm-global\\openclaw\.cmd"?|openclaw(?:\.cmd)?)\s+agents\s+list\s+--json$/i,
];

function normalizeWinPath(value) {
  return win.resolve(String(value || DEFAULT_ROOT).replaceAll('/', '\\'));
}

function fencedPath(value) {
  const lower = normalizeWinPath(value).toLowerCase();
  return '\\' + lower.replaceAll('/', '\\') + (lower.endsWith('\\') ? '' : '\\');
}

function isInsideRoots(candidate, roots) {
  const lower = normalizeWinPath(candidate).toLowerCase();
  return roots.some((root) => {
    const base = normalizeWinPath(root).toLowerCase();
    return lower === base || lower.startsWith(base + '\\');
  });
}

function isInsideAllowedRoot(candidate) {
  return isInsideRoots(candidate, PC_OPERATOR_ROOTS);
}

function assertNotSensitive(candidate) {
  const fenced = fencedPath(candidate);
  if (DENIED_PATH_FRAGMENTS.some((fragment) => fenced.includes(fragment))) {
    throw new Error('TIGERIQ_PC_SENSITIVE_PATH_BLOCKED');
  }
}

export function resolveOperatorPath(value, { allowRoot = true } = {}) {
  const raw = String(value || DEFAULT_ROOT).trim();
  const candidate = normalizeWinPath(win.isAbsolute(raw) ? raw : win.join(DEFAULT_ROOT, raw));
  if (!isInsideAllowedRoot(candidate) || (!allowRoot && PC_OPERATOR_ROOTS.some((root) => normalizeWinPath(root).toLowerCase() === candidate.toLowerCase()))) {
    throw new Error('TIGERIQ_PC_PATH_NOT_ALLOWED');
  }
  assertNotSensitive(candidate);
  return candidate;
}

export function assertWritePathAllowed(value) {
  const candidate = resolveOperatorPath(value, { allowRoot: false });
  if (!isInsideRoots(candidate, PC_WRITE_ROOTS)) {
    throw new Error('TIGERIQ_PC_WRITE_PATH_NOT_ALLOWED');
  }
  return candidate;
}

async function realPathInsideRoots(candidate, { forWrite = false } = {}) {
  const lexical = forWrite ? assertWritePathAllowed(candidate) : resolveOperatorPath(candidate);
  let probe = lexical;
  if (forWrite) {
    while (true) {
      try {
        await fs.stat(probe);
        break;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const parent = win.dirname(probe);
        if (parent === probe) throw new Error('TIGERIQ_PC_PATH_NOT_ALLOWED');
        probe = parent;
      }
    }
  }
  const realProbe = normalizeWinPath(await fs.realpath(probe));
  if (!isInsideAllowedRoot(realProbe)) throw new Error('TIGERIQ_PC_REALPATH_ESCAPE_BLOCKED');
  assertNotSensitive(realProbe);
  return lexical;
}

export function assertShellCommandAllowed(command) {
  const text = String(command || '').trim();
  if (!text || text.length > 8000) throw new Error('TIGERIQ_PC_COMMAND_INVALID');
  if (/[\r\n;&|><\x60$(){}[\]]/.test(text)) throw new Error('TIGERIQ_PC_COMMAND_NOT_ALLOWLISTED');
  if (!SAFE_SHELL_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new Error('TIGERIQ_PC_COMMAND_NOT_ALLOWLISTED');
  }
  return text;
}

function boundedText(value) {
  const text = String(value || '');
  return text.length <= MAX_OUTPUT_CHARS ? text : text.slice(0, MAX_OUTPUT_CHARS) + '\n[TRUNCATED]';
}

function safeChildEnv() {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
    const value = process.env[key];
    if (typeof value === 'string' && value) env[key] = value;
  }
  return env;
}

async function spawnBounded(exe, args, { cwd = DEFAULT_ROOT, timeoutSec = 60 } = {}) {
  const safeCwd = await realPathInsideRoots(cwd || DEFAULT_ROOT);
  const timeout = Math.max(1, Math.min(MAX_TIMEOUT_SEC, Number(timeoutSec) || 60));
  return await new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: safeCwd,
      windowsHide: true,
      env: safeChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > MAX_OUTPUT_CHARS * 2) stdout = stdout.slice(-MAX_OUTPUT_CHARS); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > MAX_OUTPUT_CHARS * 2) stderr = stderr.slice(-MAX_OUTPUT_CHARS); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout * 1000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: typeof code === 'number' ? code : -1,
        timedOut,
        stdout: boundedText(stdout),
        stderr: boundedText(stderr),
        cwd: safeCwd,
      });
    });
  });
}

async function runShell({ command, cwd, shell = 'powershell', timeoutSec = 60 }) {
  const safeCommand = assertShellCommandAllowed(command);
  const useCmd = shell === 'cmd';
  const result = await spawnBounded(
    useCmd ? 'cmd.exe' : 'powershell.exe',
    useCmd
      ? ['/d', '/s', '/c', safeCommand]
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', safeCommand],
    { cwd, timeoutSec },
  );
  return { ...result, shell: useCmd ? 'cmd' : 'powershell' };
}

export function assertTigerIQTaskName(value) {
  const taskName = String(value || '').trim();
  if (!/^TigerIQ [A-Za-z0-9 ._()#-]{1,100}$/.test(taskName)) throw new Error('TIGERIQ_PC_TASK_NOT_ALLOWED');
  return taskName;
}

async function runTaskAction(action, taskName) {
  const name = assertTigerIQTaskName(taskName);
  if (action === 'task_status') {
    return { taskName: name, ...(await spawnBounded('schtasks.exe', ['/Query', '/TN', name, '/FO', 'LIST', '/V'], { timeoutSec: 15 })) };
  }
  if (action === 'task_start') {
    return { taskName: name, ...(await spawnBounded('schtasks.exe', ['/Run', '/TN', name], { timeoutSec: 15 })) };
  }
  if (action === 'task_stop') {
    return { taskName: name, ...(await spawnBounded('schtasks.exe', ['/End', '/TN', name], { timeoutSec: 15 })) };
  }
  if (action === 'task_restart') {
    const stopped = await spawnBounded('schtasks.exe', ['/End', '/TN', name], { timeoutSec: 15 });
    const started = await spawnBounded('schtasks.exe', ['/Run', '/TN', name], { timeoutSec: 15 });
    return { taskName: name, stopped, started };
  }
  throw new Error('TIGERIQ_PC_TASK_ACTION_NOT_ALLOWED');
}

async function tcpProbe(host, port, timeoutMs = 2500) {
  const safeHost = String(host || '127.0.0.1').toLowerCase();
  const safePort = Number(port);
  if (!ALLOWED_TCP_HOSTS.has(safeHost) || !ALLOWED_TCP_PORTS.has(safePort)) {
    throw new Error('TIGERIQ_PC_TCP_TARGET_NOT_ALLOWED');
  }
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok, reason) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ host: safeHost, port: safePort, reachable: ok, reason });
    };
    socket.setTimeout(Math.max(250, Math.min(5000, Number(timeoutMs) || 2500)));
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (error) => finish(false, error.code || 'error'));
    socket.connect(safePort, safeHost);
  });
}

async function readTextFile(filePath) {
  const safePath = await realPathInsideRoots(filePath);
  const stat = await fs.stat(safePath);
  if (!stat.isFile()) throw new Error('TIGERIQ_PC_NOT_A_FILE');
  if (stat.size > MAX_READ_BYTES) throw new Error('TIGERIQ_PC_FILE_TOO_LARGE');
  return { path: safePath, size: stat.size, content: await fs.readFile(safePath, 'utf8') };
}

async function writeTextFile(filePath, content) {
  const safePath = await realPathInsideRoots(filePath, { forWrite: true });
  const text = String(content ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_WRITE_BYTES) throw new Error('TIGERIQ_PC_WRITE_TOO_LARGE');
  await fs.mkdir(win.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, text, 'utf8');
  const stat = await fs.stat(safePath);
  return { path: safePath, size: stat.size };
}

async function listPath(dirPath) {
  const safePath = await realPathInsideRoots(dirPath || DEFAULT_ROOT);
  const entries = await fs.readdir(safePath, { withFileTypes: true });
  return {
    path: safePath,
    entries: entries.slice(0, 250).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
    })),
    truncated: entries.length > 250,
  };
}

async function statPath(targetPath) {
  const safePath = await realPathInsideRoots(targetPath);
  const stat = await fs.stat(safePath);
  return {
    path: safePath,
    type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function executePcAction(input) {
  const started = Date.now();
  const action = String(input?.action || '');
  let data;
  if (action === 'shell_exec') {
    data = await runShell(input || {});
  } else if (['task_status', 'task_start', 'task_stop', 'task_restart'].includes(action)) {
    data = await runTaskAction(action, input?.taskName);
  } else if (action === 'process_list') {
    data = await spawnBounded('tasklist.exe', ['/FO', 'CSV', '/NH'], { timeoutSec: 15 });
  } else if (action === 'tcp_probe') {
    data = await tcpProbe(input?.host, input?.port);
  } else if (action === 'file_read') {
    data = await readTextFile(input?.path);
  } else if (action === 'file_write') {
    data = await writeTextFile(input?.path, input?.content);
  } else if (action === 'file_list') {
    data = await listPath(input?.path);
  } else if (action === 'file_stat') {
    data = await statPath(input?.path);
  } else {
    throw new Error('TIGERIQ_PC_ACTION_NOT_ALLOWED');
  }
  return {
    ok: true,
    action,
    target: 'pc01-local',
    elapsedMs: Date.now() - started,
    data,
    evidence: {
      transport: 'local-process',
      shell: action === 'shell_exec',
      shellMode: action === 'shell_exec' ? 'strict-allowlist' : 'none',
      fileAccess: action.startsWith('file_'),
      allowedRoots: PC_OPERATOR_ROOTS,
      inheritedSecretEnvironment: false,
      destructiveDelete: false,
      writeRoots: PC_WRITE_ROOTS,
      sourceWriteBlocked: true,
      sensitivePathsBlocked: true,
      productionMutationBlocked: true,
    },
  };
}
