import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
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

const DENIED_PATH_FRAGMENTS = [
  '\\tigeriq\\secrets\\',
  '\\tigeriq-openclaw\\state\\',
  '\\.ssh\\',
  '\\appdata\\local\\google\\chrome\\user data\\',
  '\\appdata\\local\\microsoft\\edge\\user data\\',
  '\\.env\\',
  '\\.npmrc\\',
];

const DENIED_COMMAND_PATTERNS = [
  /\b(?:shutdown|restart-computer|stop-computer)\b/i,
  /\b(?:rd|rmdir|del|erase|remove-item)\b/i,
  /\b(?:format|diskpart|bcdedit|cipher)\b/i,
  /\b(?:stop-process|stop-service|set-service|taskkill|takeown|icacls)\b/i,
  /\b(?:reg|cmdkey|vaultcmd|rundll32)\b/i,
  /\bschtasks\b[^\r\n]*\/delete\b/i,
  /\bgit\s+(?:clean\b|reset\b[^\r\n]*--hard|checkout\b[^\r\n]*--\s*\.|restore\b[^\r\n]*\s\.)(?:[^\r\n]*)/i,
  /\b(?:invoke-expression|iex|start-process)\b/i,
  /\b(?:powershell|pwsh|cmd)(?:\.exe)?\b/i,
  /-(?:encodedcommand|enc)\b/i,
  /\bvercel\b[^\r\n]*--prod\b/i,
  /\bgit\s+push\b[^\r\n]*(?:\bmain\b|\bmaster\b)/i,
  /\bgh\s+pr\s+merge\b/i,
  /\bnpm\s+publish\b/i,
  /(?:^|[\\/])\.\.(?:[\\/]|$)/,
  /\$env:/i,
  /\b(?:get-childitem|dir|set)\s+env:/i,
  /%[A-Za-z_][A-Za-z0-9_]*%/,
  /(?:^|[\\/])(?:secrets|\.ssh)(?:[\\/]|$)/i,
  /tigeriq-openclaw[\\/]state/i,
  /github-command-center\.token/i,
];

function normalizeWinPath(value) {
  return win.resolve(String(value || DEFAULT_ROOT).replaceAll('/', '\\'));
}

export function resolveOperatorPath(value, { allowRoot = true } = {}) {
  const raw = String(value || DEFAULT_ROOT).trim();
  const candidate = normalizeWinPath(win.isAbsolute(raw) ? raw : win.join(DEFAULT_ROOT, raw));
  const lower = candidate.toLowerCase();
  const allowed = PC_OPERATOR_ROOTS.some((root) => {
    const base = normalizeWinPath(root).toLowerCase();
    return lower === base || lower.startsWith(base + '\\');
  });
  if (!allowed || (!allowRoot && PC_OPERATOR_ROOTS.some((root) => lower === normalizeWinPath(root).toLowerCase()))) {
    throw new Error('TIGERIQ_PC_PATH_NOT_ALLOWED');
  }
  const fenced = '\\' + lower.replaceAll('/', '\\') + (lower.endsWith('\\') ? '' : '\\');
  if (DENIED_PATH_FRAGMENTS.some((fragment) => fenced.includes(fragment))) {
    throw new Error('TIGERIQ_PC_SENSITIVE_PATH_BLOCKED');
  }
  return candidate;
}

export function assertShellCommandAllowed(command) {
  const text = String(command || '').trim();
  if (!text || text.length > 8000) throw new Error('TIGERIQ_PC_COMMAND_INVALID');
  if (DENIED_COMMAND_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new Error('TIGERIQ_PC_COMMAND_REQUIRES_OWNER_APPROVAL');
  }
  const explicitPaths = text.match(/[A-Za-z]:\\[^"'\`\r\n|;&)]*/g) || [];
  for (const rawPath of explicitPaths) {
    const candidate = rawPath.trim().toLowerCase();
    const allowed = PC_OPERATOR_ROOTS.some((root) => {
      const base = root.toLowerCase();
      return candidate === base || candidate.startsWith(base + '\\');
    });
    if (!allowed) throw new Error('TIGERIQ_PC_COMMAND_PATH_NOT_ALLOWED');
    const fenced = '\\' + candidate + (candidate.endsWith('\\') ? '' : '\\');
    if (DENIED_PATH_FRAGMENTS.some((fragment) => fenced.includes(fragment))) {
      throw new Error('TIGERIQ_PC_COMMAND_REQUIRES_OWNER_APPROVAL');
    }
  }
  return text;
}

function boundedText(value) {
  const text = String(value || '');
  return text.length <= MAX_OUTPUT_CHARS ? text : text.slice(0, MAX_OUTPUT_CHARS) + '\n[TRUNCATED]';
}

function childEnvironment() {
  const keys = ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP'];
  return Object.fromEntries(keys.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}

async function runShell({ command, cwd, shell = 'powershell', timeoutSec = 60 }) {
  const safeCommand = assertShellCommandAllowed(command);
  const safeCwd = resolveOperatorPath(cwd || DEFAULT_ROOT);
  const timeout = Math.max(1, Math.min(MAX_TIMEOUT_SEC, Number(timeoutSec) || 60));
  const useCmd = shell === 'cmd';
  const exe = useCmd ? 'cmd.exe' : 'powershell.exe';
  const args = useCmd
    ? ['/d', '/s', '/c', safeCommand]
    : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', safeCommand];

  return await new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: safeCwd,
      windowsHide: true,
      env: childEnvironment(),
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
        shell: useCmd ? 'cmd' : 'powershell',
      });
    });
  });
}

async function readTextFile(filePath) {
  const safePath = resolveOperatorPath(filePath, { allowRoot: false });
  const stat = await fs.stat(safePath);
  if (!stat.isFile()) throw new Error('TIGERIQ_PC_NOT_A_FILE');
  if (stat.size > MAX_READ_BYTES) throw new Error('TIGERIQ_PC_FILE_TOO_LARGE');
  return { path: safePath, size: stat.size, content: await fs.readFile(safePath, 'utf8') };
}

async function writeTextFile(filePath, content) {
  const safePath = resolveOperatorPath(filePath, { allowRoot: false });
  const text = String(content ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_WRITE_BYTES) throw new Error('TIGERIQ_PC_WRITE_TOO_LARGE');
  await fs.mkdir(win.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, text, 'utf8');
  const stat = await fs.stat(safePath);
  return { path: safePath, size: stat.size };
}

async function listPath(dirPath) {
  const safePath = resolveOperatorPath(dirPath || DEFAULT_ROOT);
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
  const safePath = resolveOperatorPath(targetPath);
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
      fileAccess: action.startsWith('file_'),
      allowedRoots: PC_OPERATOR_ROOTS,
      destructiveDelete: false,
      sensitivePathsBlocked: true,
      productionMutationBlocked: true,
      inheritedProcessSecrets: false,
    },
  };
}
