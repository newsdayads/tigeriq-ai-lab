import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { PAD_UI_ACTIONS, executePadUiAction } from './pad-ui.mjs';
import { PAPERCLIP_LAB_ACTIONS, executePaperclipLabAction } from './paperclip-lab.mjs';

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

function safeChildEnv(extraKeys = []) {
  const env = {};
  const keys = [...new Set(['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP', ...(Array.isArray(extraKeys) ? extraKeys : [])])];
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value) env[key] = value;
  }
  return env;
}

async function spawnBounded(exe, args, { cwd = DEFAULT_ROOT, timeoutSec = 60, extraEnvKeys = [] } = {}) {
  const safeCwd = await realPathInsideRoots(cwd || DEFAULT_ROOT);
  const timeout = Math.max(1, Math.min(MAX_TIMEOUT_SEC, Number(timeoutSec) || 60));
  return await new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: safeCwd,
      windowsHide: true,
      env: safeChildEnv(extraEnvKeys),
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

function successfulTaskProcessResult(result) {
  return Boolean(
    result
    && typeof result === 'object'
    && result.timedOut === false
    && typeof result.exitCode === 'number'
    && Number.isInteger(result.exitCode)
    && result.exitCode === 0
  );
}

function trustedTaskVerification(action, taskName, verification) {
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return false;
  if (verification.taskName !== taskName) return false;
  const state = String(verification.state || '').trim().toLowerCase();
  if (!state) return false;
  if (action === 'task_stop') return state !== 'running';
  if (state === 'running') return true;
  const lastRun = String(verification.lastRun ?? '').trim();
  const previousLastRun = String(verification.previousLastRun ?? '').trim();
  return state === 'ready'
    && String(verification.lastResult ?? '').trim() === '0'
    && Boolean(lastRun)
    && Boolean(previousLastRun)
    && lastRun !== previousLastRun;
}

export function trustedTigerIQTaskActionData(action, data) {
  const kind = String(action || '').toLowerCase();
  if (!['task_start', 'task_stop', 'task_restart'].includes(kind) || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  let taskName;
  try { taskName = assertTigerIQTaskName(data.taskName); } catch { return false; }
  const subprocessOk = kind === 'task_restart'
    ? successfulTaskProcessResult(data.stopped) && successfulTaskProcessResult(data.started)
    : successfulTaskProcessResult(data);
  return subprocessOk && trustedTaskVerification(kind, taskName, data.verification);
}

function assertTaskProcessSuccess(result, phase) {
  if (result?.timedOut === true) throw new Error(`TIGERIQ_PC_TASK_${phase}_TIMEOUT`);
  if (!result || Number(result.exitCode) !== 0) throw new Error(`TIGERIQ_PC_TASK_${phase}_FAILED`);
  return result;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text || '');

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => String(value).length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => String(value).length > 0)) rows.push(row);
  }
  if (quoted) throw new Error('TIGERIQ_PC_TASK_LIST_CSV_INVALID');
  return rows;
}

function nullableCell(row, index) {
  const value = String(row[index] ?? '').trim();
  return value || null;
}

export function parseTaskListCsv(text) {
  const tasks = [];
  for (const row of parseCsvRows(text)) {
    if (row.length < 9) continue;
    const rawName = String(row[1] ?? '').trim();
    const taskName = rawName.replace(/^\\+/, '');
    if (!taskName.startsWith('TigerIQ ')) continue;

    assertTigerIQTaskName(taskName);
    const triggerParts = row
      .slice(17)
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);

    tasks.push({
      taskName,
      state: nullableCell(row, 3),
      lastRun: nullableCell(row, 5),
      lastResult: nullableCell(row, 6),
      action: nullableCell(row, 8),
      trigger: triggerParts.length > 0 ? triggerParts.join(' | ') : null,
    });
  }
  return tasks;
}

export function parseCompactTaskListCsv(text) {
  const tasks = [];
  for (const row of parseCsvRows(text)) {
    const rawName = String(row[0] ?? '').trim();
    const taskName = rawName.replace(/^\\+/, '');
    if (!taskName.startsWith('TigerIQ ')) continue;
    tasks.push({ taskName: assertTigerIQTaskName(taskName) });
  }
  return tasks;
}

async function listTigerIQTasks() {
  const result = await spawnBounded(
    'schtasks.exe',
    ['/Query', '/FO', 'CSV', '/NH'],
    { timeoutSec: 30 },
  );
  if (result.timedOut) throw new Error('TIGERIQ_PC_TASK_LIST_TIMEOUT');
  if (result.exitCode !== 0) throw new Error('TIGERIQ_PC_TASK_LIST_FAILED');
  if (result.stdout.includes('[TRUNCATED]')) throw new Error('TIGERIQ_PC_TASK_LIST_TRUNCATED');
  const tasks = parseCompactTaskListCsv(result.stdout);
  return {
    readOnly: true,
    scope: 'TigerIQ',
    count: tasks.length,
    taskNames: tasks.map((task) => task.taskName),
    releaseTaskNames: tasks.map((task) => task.taskName).filter((name) => /(?:android|worker|release|sign|apk|build|stable|elevated)/i.test(name)),
    tasks,
  };
}

async function queryTigerIQTaskVerification(taskName) {
  const name = assertTigerIQTaskName(taskName);
  const result = await spawnBounded('schtasks.exe', ['/Query', '/TN', name, '/FO', 'CSV', '/V', '/NH'], { timeoutSec: 15 });
  assertTaskProcessSuccess(result, 'VERIFY');
  if (result.stdout.includes('[TRUNCATED]')) throw new Error('TIGERIQ_PC_TASK_VERIFY_TRUNCATED');
  const task = parseTaskListCsv(result.stdout).find((item) => item.taskName === name);
  if (!task) throw new Error('TIGERIQ_PC_TASK_VERIFY_MISSING');
  return {
    taskName: name,
    state: task.state,
    lastRun: task.lastRun,
    lastResult: task.lastResult,
  };
}

async function runTaskAction(action, taskName) {
  const name = assertTigerIQTaskName(taskName);
  if (action === 'task_status') {
    return { taskName: name, ...(await spawnBounded('schtasks.exe', ['/Query', '/TN', name, '/FO', 'LIST', '/V'], { timeoutSec: 15 })) };
  }
  if (action === 'task_start') {
    const before = await queryTigerIQTaskVerification(name);
    const result = await spawnBounded('schtasks.exe', ['/Run', '/TN', name], { timeoutSec: 15 });
    assertTaskProcessSuccess(result, 'START');
    const verification = { ...(await queryTigerIQTaskVerification(name)), previousLastRun: before.lastRun };
    return { taskName: name, ...result, verification };
  }
  if (action === 'task_stop') {
    const result = await spawnBounded('schtasks.exe', ['/End', '/TN', name], { timeoutSec: 15 });
    assertTaskProcessSuccess(result, 'STOP');
    return { taskName: name, ...result, verification: await queryTigerIQTaskVerification(name) };
  }
  if (action === 'task_restart') {
    const before = await queryTigerIQTaskVerification(name);
    const stopped = await spawnBounded('schtasks.exe', ['/End', '/TN', name], { timeoutSec: 15 });
    assertTaskProcessSuccess(stopped, 'RESTART_STOP');
    const started = await spawnBounded('schtasks.exe', ['/Run', '/TN', name], { timeoutSec: 15 });
    assertTaskProcessSuccess(started, 'RESTART_START');
    const verification = { ...(await queryTigerIQTaskVerification(name)), previousLastRun: before.lastRun };
    return { taskName: name, stopped, started, verification };
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


export function androidReleaseBuildFailureClass(result = {}) {
  const text = `${String(result?.stderr || '')}\n${String(result?.stdout || '')}`.toUpperCase();
  const allowed = [
    'STABLE_SIGNING_DIR_REQUIRED',
    'STABLE_SIGNING_ALIAS_REQUIRED',
    'STABLE_SIGNING_NOT_PROVISIONED',
    'CANONICAL_SIGNING_IDENTITY_MISMATCH',
    'KEYTOOL_MISSING',
    'KEYSTORE_VERIFY_FAILED',
    'KEYSTORE_CERTIFICATE_FINGERPRINT_NOT_FOUND',
    'KEYSTORE_SIGNING_IDENTITY_MISMATCH',
    'GRADLE_WRAPPER_MISSING',
    'GRADLE_COMMAND_MISSING',
    'ANDROID_RELEASE_BUILD_FAILED',
    'UNSIGNED_APK_NOT_FOUND',
    'DPAPI_SIGNER_HELPER_MISSING',
    'DPAPI_SIGNER_RECEIPT_MISSING',
    'DPAPI_SIGNER_RECEIPT_INVALID',
    'DPAPI_SIGNER_STATUS_INVALID',
    'SIGNING_SECRET_SAFETY_VIOLATION',
    'SIGNED_APK_SHA256_MISMATCH',
    'ANDROID_APKSIGNER_DISCOVERY_NO_SDK_ROOT',
    'ANDROID_APKSIGNER_DISCOVERY_NO_BUILD_TOOLS_DIR',
    'ANDROID_APKSIGNER_DISCOVERY_BINARY_MISSING',
    'ANDROID_ZIPALIGN_DISCOVERY_NO_SDK_ROOT',
    'ANDROID_ZIPALIGN_DISCOVERY_NO_BUILD_TOOLS_DIR',
    'ANDROID_ZIPALIGN_DISCOVERY_BINARY_MISSING',
    'ANDROID_BUILD_TOOL_REQUIRED',
    'ANDROID_BUILD_TOOL_FAILED',
    'APKSIGNER_FAILED',
    'SIGNED_APK_NOT_FOUND',
    'APKSIGNER_MISSING',
    'APK_SIGNATURE_VERIFY_FAILED',
    'APK_CERTIFICATE_FINGERPRINT_NOT_FOUND',
    'APK_SIGNING_IDENTITY_MISMATCH',
    'WORKER_VERSION_NOT_FOUND',
  ];
  return allowed.find((code) => text.includes(code)) || 'UNCLASSIFIED';
}

async function buildAndroidWorkerStableRelease() {
  const repoRoot = 'D:\\TigerIQ\\Runtime\\CoreSource';
  const script = 'D:\\TigerIQ\\Runtime\\CoreSource\\scripts\\pc-worker\\build-android-worker-release.ps1';
  const secretsDir = 'D:\\TigerIQ\\Secrets\\AndroidSigning';
  const releaseRoot = 'D:\\TigerIQ\\Releases\\AndroidWorker\\signed';
  const runtimeStatePath = 'D:\\TigerIQ\\State\\core-runtime-updater.json';
  await realPathInsideRoots(script);
  const runtimeState = JSON.parse(await fs.readFile(await realPathInsideRoots(runtimeStatePath), 'utf8'));
  const installedSha = String(runtimeState?.installedSha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(installedSha)) throw new Error('TIGERIQ_ANDROID_RELEASE_INSTALLED_SHA_MISSING');
  const result = await spawnBounded(
    'powershell.exe',
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-RepoRoot',repoRoot,'-SecretsDir',secretsDir,'-ReleaseRoot',releaseRoot],
    { cwd: repoRoot, timeoutSec: 120 },
  );
  if (result.timedOut) throw new Error('TIGERIQ_ANDROID_RELEASE_BUILD_TIMEOUT');
  if (Number(result.exitCode) !== 0) {
    throw new Error(`TIGERIQ_ANDROID_RELEASE_BUILD_FAILED:${androidReleaseBuildFailureClass(result)}`);
  }
  const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let receipt = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && parsed.status === 'ANDROID_WORKER_STABLE_RELEASE_READY') { receipt = parsed; break; }
    } catch {}
  }
  if (!receipt) throw new Error('TIGERIQ_ANDROID_RELEASE_RECEIPT_MISSING');
  const expectedSigner = '63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293';
  if (String(receipt.certificateSha256 || '').replaceAll(':','').toUpperCase() !== expectedSigner) {
    throw new Error('TIGERIQ_ANDROID_RELEASE_SIGNER_MISMATCH');
  }
  if (receipt.secretsPrinted !== false) throw new Error('TIGERIQ_ANDROID_RELEASE_SECRET_OUTPUT_UNSAFE');
  const sourceSha = String(receipt.sourceSha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error('TIGERIQ_ANDROID_RELEASE_SOURCE_SHA_MISSING');
  if (sourceSha !== installedSha) throw new Error('TIGERIQ_ANDROID_RELEASE_SOURCE_SHA_MISMATCH');
  return {
    status: receipt.status,
    version: String(receipt.version || ''),
    apk: String(receipt.apk || ''),
    manifest: String(receipt.manifest || ''),
    apkSha256: String(receipt.apkSha256 || '').toUpperCase(),
    certificateSha256: expectedSigner,
    sourceSha,
    installedSha,
    secretsPrinted: false,
  };
}


const ANDROID_V020_CI_ARTIFACT = Object.freeze({
  repo: 'newsdayads/tigeriq-ai-lab',
  runId: '37110333387',
  artifactName: 'tigeriq-worker-unsigned-release-apk',
  artifactId: '11269092955',
  sourceHead: 'fb25369f483a48f818e6a885b248eb629f53cf95',
  expectedUnsignedSha256: 'BDC32789297BB5304AE423476D8C4170C9D17C0B9AC2D7C5533DA42FBA82F598',
  expectedVersion: '0.20.0-update-lease-guard',
  expectedSignerSha256: '63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293',
});

async function signAndroidWorkerV020CiArtifact() {
  const spec = ANDROID_V020_CI_ARTIFACT;
  const repoRoot = 'D:\\TigerIQ\\Runtime\\CoreSource';
  const helper = 'D:\\TigerIQ\\Runtime\\CoreSource\\scripts\\pc-worker\\sign-android-worker-with-dpapi.ps1';
  const secretsDir = 'D:\\TigerIQ\\Secrets\\AndroidSigning';
  const downloadDir = 'D:\\TigerIQ\\Releases\\AndroidWorker\\ci-artifact\\v0.20';
  const releaseDir = 'D:\\TigerIQ\\Releases\\AndroidWorker\\signed\\0.20.0-update-lease-guard';
  const unsignedApk = win.join(downloadDir, 'tigeriq-worker-unsigned-release.apk');
  const outputApk = win.join(releaseDir, 'TIQ Worker v0.20.apk');
  const manifestPath = win.join(releaseDir, 'release-manifest.json');

  await realPathInsideRoots(helper);
  await fs.rm(downloadDir, { recursive: true, force: true });
  await fs.mkdir(downloadDir, { recursive: true });
  await fs.mkdir(releaseDir, { recursive: true });

  const githubToken = String(process.env.TIGERIQ_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (!githubToken) throw new Error('TIGERIQ_GH_AUTH_REQUIRED');
  const artifactZip = win.join(downloadDir, 'artifact.zip');
  const artifactUrl = `https://api.github.com/repos/${spec.repo}/actions/artifacts/${spec.artifactId}/zip`;
  let response;
  try {
    response = await fetch(artifactUrl, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${githubToken}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'TigerIQ-Core',
      },
      redirect: 'follow',
    });
  } catch {
    throw new Error('TIGERIQ_GH_ARTIFACT_DOWNLOAD_FAILED');
  }
  if (response.status === 401 || response.status === 403) throw new Error('TIGERIQ_GH_AUTH_REQUIRED');
  if (!response.ok) throw new Error('TIGERIQ_GH_ARTIFACT_DOWNLOAD_FAILED');
  const archive = Buffer.from(await response.arrayBuffer());
  if (!archive.length || archive.length > 250 * 1024 * 1024) throw new Error('TIGERIQ_GH_ARTIFACT_ARCHIVE_INVALID');
  const zipMagic = archive.subarray(0,4).toString('hex').toLowerCase();
  if (!['504b0304','504b0506','504b0708'].includes(zipMagic)) throw new Error('TIGERIQ_GH_ARTIFACT_ARCHIVE_INVALID');
  await fs.writeFile(artifactZip, archive);
  const extract = await spawnBounded(
    'powershell.exe',
    ['-NoProfile','-NonInteractive','-Command',
      '& { param([string]$zip,[string]$dest) Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force }',
      artifactZip,downloadDir],
    { cwd: repoRoot, timeoutSec: 120 },
  );
  if (extract.timedOut) throw new Error('TIGERIQ_GH_ARTIFACT_DOWNLOAD_TIMEOUT');
  if (Number(extract.exitCode) !== 0) throw new Error('TIGERIQ_GH_ARTIFACT_ARCHIVE_INVALID');

  await realPathInsideRoots(unsignedApk);
  const actualUnsignedSha256 = createHash('sha256')
    .update(await fs.readFile(unsignedApk))
    .digest('hex')
    .toUpperCase();
  if (actualUnsignedSha256 !== spec.expectedUnsignedSha256) {
    throw new Error('TIGERIQ_ANDROID_CI_ARTIFACT_SHA256_MISMATCH');
  }

  const signed = await spawnBounded(
    'powershell.exe',
    [
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-File',helper,
      '-UnsignedApk',unsignedApk,
      '-OutputApk',outputApk,
      '-ExpectedUnsignedSha256',spec.expectedUnsignedSha256,
      '-SecretsDir',secretsDir,
    ],
    {
      cwd: repoRoot,
      timeoutSec: 120,
      extraEnvKeys: ['LOCALAPPDATA', 'ANDROID_SDK_ROOT', 'ANDROID_HOME'],
    },
  );
  if (signed.timedOut) throw new Error('TIGERIQ_ANDROID_CI_ARTIFACT_SIGN_TIMEOUT');
  if (Number(signed.exitCode) !== 0) {
    throw new Error('TIGERIQ_ANDROID_CI_ARTIFACT_SIGN_FAILED:' + androidReleaseBuildFailureClass(signed));
  }

  const lines = String(signed.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let receipt = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed?.status === 'ANDROID_WORKER_CANONICAL_SIGNING_READY') { receipt = parsed; break; }
    } catch {}
  }
  if (!receipt) throw new Error('TIGERIQ_ANDROID_CI_ARTIFACT_SIGN_RECEIPT_MISSING');
  if (String(receipt.certificateSha256 || '').replaceAll(':','').toUpperCase() !== spec.expectedSignerSha256) {
    throw new Error('TIGERIQ_ANDROID_RELEASE_SIGNER_MISMATCH');
  }
  if (receipt.v2 !== true || receipt.v3 !== true) throw new Error('TIGERIQ_ANDROID_RELEASE_SIGNATURE_SCHEME_MISMATCH');
  if (receipt.plaintextSecretPrinted !== false || receipt.plaintextSecretWrittenToDisk !== false) {
    throw new Error('TIGERIQ_ANDROID_RELEASE_SECRET_OUTPUT_UNSAFE');
  }
  const signedSha256 = String(receipt.signedSha256 || '').replaceAll(':','').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(signedSha256)) throw new Error('TIGERIQ_ANDROID_RELEASE_SIGNED_SHA256_INVALID');

  const manifest = {
    schema: 'tigeriq.android-worker.release.v1',
    createdAt: new Date().toISOString(),
    version: spec.expectedVersion,
    sourceSha: spec.sourceHead,
    sourceWorkflowRunId: spec.runId,
    sourceArtifactId: spec.artifactId,
    sourceArtifactName: spec.artifactName,
    unsignedApkSha256: actualUnsignedSha256,
    apk: win.basename(outputApk),
    apkSha256: signedSha256,
    certificateSha256: spec.expectedSignerSha256,
    signingIdentity: 'stable-private-pc01-dpapi-stdin',
    secretsIncluded: false,
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return {
    status: 'ANDROID_WORKER_STABLE_RELEASE_READY',
    version: spec.expectedVersion,
    apk: outputApk,
    manifest: manifestPath,
    apkSha256: signedSha256,
    unsignedApkSha256: actualUnsignedSha256,
    certificateSha256: spec.expectedSignerSha256,
    sourceSha: spec.sourceHead,
    sourceWorkflowRunId: spec.runId,
    sourceArtifactId: spec.artifactId,
    signingIdentity: 'stable-private-pc01-dpapi-stdin',
    passwordTransport: 'stdin-only',
    secretsPrinted: false,
  };
}


export function assertTigerIQLive3150DeployRequest(input = {}) {
  const expectedSha = String(input?.expectedSha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error('TIGERIQ_VERCEL_EXPECTED_SHA_INVALID');
  return { expectedSha };
}

async function deployTigerIQLive3150(input = {}) {
  const { expectedSha } = assertTigerIQLive3150DeployRequest(input);
  const repoRoot = 'D:\\TigerIQ\\Runtime\\CoreSource';
  const script = 'D:\\TigerIQ\\Runtime\\CoreSource\\scripts\\pc-worker\\vercel-tigeriq-live-3150-deploy.mjs';
  await realPathInsideRoots(script);
  const result = await spawnBounded(
    process.execPath,
    [script, '--sha', expectedSha, '--issue', '3185'],
    {
      cwd: repoRoot,
      timeoutSec: 120,
      extraEnvKeys: ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME'],
    },
  );
  if (result.timedOut) throw new Error('TIGERIQ_VERCEL_DEPLOY_TIMEOUT');
  if (Number(result.exitCode) !== 0) {
    const code = String(result.stderr || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || 'VERCEL_DEPLOY_FAILED';
    if (!/^VERCEL_[A-Z0-9_]+$/.test(code)) throw new Error('TIGERIQ_VERCEL_DEPLOY_FAILED');
    throw new Error(code);
  }
  const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let receipt = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed?.status === 'TIGERIQ_LIVE_3150_PRODUCTION_DEPLOYED') { receipt = parsed; break; }
    } catch {}
  }
  if (!receipt) throw new Error('TIGERIQ_VERCEL_DEPLOY_RECEIPT_MISSING');
  if (receipt.projectId !== 'prj_gg7AuV6y62TALzEpby8XUAFisLKw'
      || receipt.teamId !== 'team_K8HIG7zmwu0ZjCINX1VhlGiT'
      || receipt.repo !== 'newsdayads/tigeriq-ai-lab'
      || receipt.branch !== 'main'
      || receipt.issue !== '3185'
      || receipt.target !== 'production'
      || receipt.exactSha !== expectedSha
      || receipt.maxAttempts !== 1
      || receipt.secretsPrinted !== false
      || !/^https:\/\/[^\s]+\.vercel\.app$/i.test(String(receipt.deploymentUrl || ''))) {
    throw new Error('TIGERIQ_VERCEL_DEPLOY_RECEIPT_INVALID');
  }
  return {
    status: receipt.status,
    deploymentUrl: receipt.deploymentUrl,
    projectId: receipt.projectId,
    teamId: receipt.teamId,
    repo: receipt.repo,
    branch: receipt.branch,
    target: receipt.target,
    exactSha: receipt.exactSha,
    issue: receipt.issue,
    maxAttempts: 1,
    secretsPrinted: false,
  };
}

export async function executePcAction(input, options = {}) {
  const started = Date.now();
  const action = String(input?.action || '');
  let data;
  let capabilityEvidence = null;
  if (action === 'shell_exec') {
    data = await runShell(input || {});
  } else if (action === 'task_list') {
    data = await listTigerIQTasks();
  } else if (action === 'android_worker_release_build') {
    data = await buildAndroidWorkerStableRelease();
  } else if (action === 'android_worker_sign_v020_ci_artifact') {
    data = await signAndroidWorkerV020CiArtifact();
  } else if (action === 'tigeriq_live_3150_production_deploy') {
    data = await deployTigerIQLive3150(input || {});
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
  } else if (PAPERCLIP_LAB_ACTIONS.includes(action)) {
    const result = await executePaperclipLabAction(input || {}, { signal: options?.signal });
    data = result.data;
    capabilityEvidence = result.evidence;
  } else if (PAD_UI_ACTIONS.includes(action)) {
    data = await executePadUiAction(input || {});
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
      taskListReadOnly: action === 'task_list',
      androidReleaseBuild: ['android_worker_release_build', 'android_worker_sign_v020_ci_artifact'].includes(action),
      taskListScope: action === 'task_list' ? 'TigerIQ only' : 'none',
      writeRoots: PC_WRITE_ROOTS,
      sourceWriteBlocked: true,
      sensitivePathsBlocked: true,
      productionMutationBlocked: action !== 'tigeriq_live_3150_production_deploy',
      productionMutationScope: action === 'tigeriq_live_3150_production_deploy' ? 'TigerIQ Live #3185 exact one-shot' : 'none',
      interactiveUiBroker: PAD_UI_ACTIONS.includes(action),
      interactiveUiScope: PAD_UI_ACTIONS.includes(action) ? 'Power Automate Desktop only' : 'none',
      paperclipLabCapability: PAPERCLIP_LAB_ACTIONS.includes(action),
      paperclipLabScope: PAPERCLIP_LAB_ACTIONS.includes(action) ? 'D:\\TigerIQ-Paperclip-Lab + 127.0.0.1:3210 only' : 'none',
      ...(capabilityEvidence ? { paperclipLab: capabilityEvidence } : {}),
      arbitraryCoordinates: false,
    },
  };
}
