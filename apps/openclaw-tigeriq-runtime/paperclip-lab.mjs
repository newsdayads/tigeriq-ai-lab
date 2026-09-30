import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const win = path.win32;
export const PAPERCLIP_LAB_ROOT = 'D:\\TigerIQ-Paperclip-Lab';
export const PAPERCLIP_LAB_PORT = 3210;
export const PAPERCLIP_LAB_RUNTIME_REVISION = '20260930_BROKER_DB_DIAGNOSTIC_1';
export const PAPERCLIP_LAB_RELEASE = 'v2026.916.1';
export const PAPERCLIP_LAB_RELEASE_SHA = 'd554c4789ed3930f8a53ac9fdf6503b3187097da';
export const PAPERCLIP_LAB_IMAGE_REPOSITORY = 'ghcr.io/paperclipai/paperclip';
export const PAPERCLIP_LAB_IMAGE = 'ghcr.io/paperclipai/paperclip:2026.916.1';
const PAPERCLIP_LAB_IMAGE_DIGEST_RE = /^ghcr\.io\/paperclipai\/paperclip@sha256:[a-f0-9]{64}$/;
export const PAPERCLIP_LAB_CONTAINER = 'tigeriq-paperclip-lab';
export const PAPERCLIP_LAB_ACTIONS = Object.freeze([
  'paperclip_lab_preflight',
  'paperclip_lab_broker_install',
  'paperclip_lab_install',
  'paperclip_lab_start',
  'paperclip_lab_stop',
  'paperclip_lab_health',
]);

const CONFIG_DIR = win.join(PAPERCLIP_LAB_ROOT, 'config');
const DATA_DIR = win.join(PAPERCLIP_LAB_ROOT, 'data');
const EVIDENCE_DIR = win.join(PAPERCLIP_LAB_ROOT, 'evidence');
const RESEARCH_DIR = win.join(PAPERCLIP_LAB_ROOT, 'research');
const BACKUP_DIR = win.join(PAPERCLIP_LAB_ROOT, 'backup');
const ENV_FILE = win.join(CONFIG_DIR, 'paperclip.env');
const COMPOSE_FILE = win.join(CONFIG_DIR, 'docker-compose.lab.yml');
const RELEASE_FILE = win.join(CONFIG_DIR, 'release.json');
const MAX_OUTPUT_CHARS = 32000;
const PAPERCLIP_LAB_PULL_TIMEOUT_MS = 1200000;
const PAPERCLIP_LAB_BROKER_MAX_WAIT_MS = 1210000;
const PAPERCLIP_LAB_HEALTH_READY_TIMEOUT_MS = 90000;
const PAPERCLIP_LAB_HEALTH_POLL_MS = 1500;
export const PAPERCLIP_LAB_WSL_DISTRO = 'Ubuntu';
export const PAPERCLIP_LAB_WSL_ROOT = '/mnt/d/TigerIQ-Paperclip-Lab';
const DOCKER_TRANSPORT_WINDOWS = 'windows';
const DOCKER_TRANSPORT_WSL = 'wsl-ubuntu';
const DOCKER_TRANSPORT_BROKER = 'wsl-ubuntu-interactive-broker';
const BROKER_DIR = win.join(PAPERCLIP_LAB_ROOT, 'broker');
const BROKER_REQUESTS_DIR = win.join(BROKER_DIR, 'requests');
const BROKER_RESPONSES_DIR = win.join(BROKER_DIR, 'responses');
const BROKER_HEARTBEAT_FILE = win.join(BROKER_DIR, 'heartbeat.json');
const BROKER_EXPECTED_VERSION = '1.5-db-sidecar-diagnostic';
const BROKER_SCRIPT_FILE = win.join(BROKER_DIR, 'paperclip-wsl-broker.ps1');
const BROKER_INSTALLER_FILE = win.join(BROKER_DIR, 'Install-PaperclipWslBroker.ps1');
const BROKER_SOURCE_SCRIPT = fileURLToPath(new URL('./paperclip-wsl-broker.ps1', import.meta.url));
const BROKER_SOURCE_INSTALLER = fileURLToPath(new URL('./Install-PaperclipWslBroker.ps1', import.meta.url));

function normalizeWinPath(value) {
  return win.resolve(String(value || PAPERCLIP_LAB_ROOT).replaceAll('/', '\\'));
}

export function resolvePaperclipLabPath(value = PAPERCLIP_LAB_ROOT) {
  const candidate = normalizeWinPath(value);
  const base = normalizeWinPath(PAPERCLIP_LAB_ROOT).toLowerCase();
  const lower = candidate.toLowerCase();
  if (lower !== base && !lower.startsWith(base + '\\')) {
    throw new Error('TIGERIQ_PAPERCLIP_LAB_PATH_NOT_ALLOWED');
  }
  return candidate;
}

export function paperclipLabWslPath(value = PAPERCLIP_LAB_ROOT) {
  const candidate = resolvePaperclipLabPath(value);
  const relative = win.relative(PAPERCLIP_LAB_ROOT, candidate);
  return relative
    ? PAPERCLIP_LAB_WSL_ROOT + '/' + relative.split('\\').filter(Boolean).join('/')
    : PAPERCLIP_LAB_WSL_ROOT;
}

function translateDockerArgForWsl(value) {
  const text = String(value);
  if (/^[A-Za-z]:[\\/]/.test(text)) {
    const normalized = text.replaceAll('/', '\\');
    const root = PAPERCLIP_LAB_ROOT.toLowerCase();
    const lower = normalized.toLowerCase();
    if (lower !== root && !lower.startsWith(root + '\\')) {
      throw new Error('TIGERIQ_PAPERCLIP_LAB_DOCKER_PATH_NOT_ALLOWED');
    }
    return paperclipLabWslPath(normalized);
  }
  if (/^\\\\/.test(text)) throw new Error('TIGERIQ_PAPERCLIP_LAB_DOCKER_PATH_NOT_ALLOWED');
  return text;
}

export function paperclipLabWslDockerArgs(args = []) {
  if (!Array.isArray(args)) throw new Error('TIGERIQ_PAPERCLIP_LAB_DOCKER_ARGS_INVALID');
  return ['--distribution', PAPERCLIP_LAB_WSL_DISTRO, '--exec', 'docker', ...args.map(translateDockerArgForWsl)];
}

export function assertPaperclipLabRequest(input = {}) {
  const action = String(input?.action || '');
  if (!PAPERCLIP_LAB_ACTIONS.includes(action)) throw new Error('TIGERIQ_PAPERCLIP_LAB_ACTION_NOT_ALLOWED');
  const extras = Object.keys(input).filter((key) => key !== 'action' && input[key] !== undefined);
  if (extras.length) throw new Error('TIGERIQ_PAPERCLIP_LAB_ARGUMENT_NOT_ALLOWED');
  return { action };
}

function clipped(value) {
  const text = String(value || '');
  return text.length <= MAX_OUTPUT_CHARS ? text : text.slice(-MAX_OUTPUT_CHARS) + '\n[TRUNCATED]';
}

export function paperclipDockerFailureClass(result = {}) {
  if (result?.timedOut === true) {
    const timeoutKind = String(result?.timeoutKind || '').toUpperCase();
    if (timeoutKind === 'IDLE') return 'IDLE_TIMEOUT';
    if (timeoutKind === 'TOTAL') return 'TOTAL_TIMEOUT';
    return 'TIMEOUT';
  }
  const text = `${String(result?.stderr || '')}\n${String(result?.stdout || '')}`.toLowerCase();
  if (/unauthorized|authentication required|access denied|requested access.*denied|forbidden|\b401\b|\b403\b/.test(text)) return 'AUTH';
  if (/manifest unknown|manifest.*not found|name unknown|repository does not exist|\b404\b/.test(text)) return 'IMAGE_NOT_FOUND';
  if (/x509|certificate|tls handshake|ssl/.test(text)) return 'TLS';
  if (/i\/o timeout|context deadline|timed out|timeout awaiting|client\.timeout/.test(text)) return 'NETWORK_TIMEOUT';
  if (/connection refused|network is unreachable|no such host|temporary failure|dial tcp|proxyconnect|connection reset/.test(text)) return 'NETWORK';
  if (/no space left|disk full|insufficient space/.test(text)) return 'DISK';
  const code = Number(result?.exitCode);
  return Number.isInteger(code) && code >= 0 ? `EXIT_${code}` : 'UNKNOWN';
}

function paperclipAbortError() {
  const error = new Error('TIGERIQ_PAPERCLIP_LAB_ABORTED');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw paperclipAbortError();
}

async function sleepWithSignal(ms, signal = null) {
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(paperclipAbortError());
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function baseEnv() {
  const env = {};
  for (const key of ['SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.DOCKER_CLI_HINTS = 'false';
  return env;
}

const LAB_ENV_FIXED = Object.freeze({
  HOST: '0.0.0.0',
  PAPERCLIP_HOME: '/paperclip',
  PAPERCLIP_DEPLOYMENT_MODE: 'authenticated',
  PAPERCLIP_DEPLOYMENT_EXPOSURE: 'private',
  PAPERCLIP_PUBLIC_URL: `http://localhost:${PAPERCLIP_LAB_PORT}`,
  PAPERCLIP_ALLOWED_HOSTNAMES: 'localhost,127.0.0.1',
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
});
const LAB_ENV_SECRET_KEYS = new Set(['BETTER_AUTH_SECRET','PAPERCLIP_TOOL_ACTION_SIGNING_SECRET']);
const LAB_ENV_KEYS = new Set([...Object.keys(LAB_ENV_FIXED), ...LAB_ENV_SECRET_KEYS]);

export function validatePaperclipLabEnvText(text) {
  const values = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw) continue;
    const index = raw.indexOf('=');
    if (index <= 0) throw new Error('TIGERIQ_PAPERCLIP_LAB_ENV_INVALID');
    const key = raw.slice(0, index);
    const value = raw.slice(index + 1);
    if (!LAB_ENV_KEYS.has(key) || values.has(key)) throw new Error('TIGERIQ_PAPERCLIP_LAB_ENV_NOT_ALLOWLISTED');
    values.set(key, value);
  }
  if (values.size !== LAB_ENV_KEYS.size) throw new Error('TIGERIQ_PAPERCLIP_LAB_ENV_INCOMPLETE');
  for (const [key, expected] of Object.entries(LAB_ENV_FIXED)) {
    if (values.get(key) !== expected) throw new Error('TIGERIQ_PAPERCLIP_LAB_ENV_UNSAFE');
  }
  for (const key of LAB_ENV_SECRET_KEYS) {
    if (!/^[a-f0-9]{64}$/.test(values.get(key) || '')) throw new Error('TIGERIQ_PAPERCLIP_LAB_ENV_SECRET_INVALID');
  }
  return true;
}

async function runFixed(exe, args, { cwd = PAPERCLIP_LAB_ROOT, timeoutMs = 120000, signal = null } = {}) {
  throwIfAborted(signal);
  const safeCwd = resolvePaperclipLabPath(cwd);
  await ensureRootIntegrity();
  const realCwd = await ensureContainedDirectory(safeCwd);
  return await new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: realCwd,
      windowsHide: true,
      env: baseEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', timedOut = false, aborted = false, settled = false;
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const cleanup = () => signal?.removeEventListener?.('abort', onAbort);
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      aborted = true;
      child.kill();
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once('error', finishReject);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (aborted || signal?.aborted) return reject(paperclipAbortError());
      resolve({ exitCode: typeof code === 'number' ? code : -1, timedOut, stdout: clipped(stdout), stderr: clipped(stderr) });
    });
  });
}

function parseBrokerJson(text) {
  return JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
}

async function brokerStatus() {
  try {
    const safeHeartbeat = await assertSafeFileTarget(BROKER_HEARTBEAT_FILE);
    const heartbeat = parseBrokerJson(await fs.readFile(safeHeartbeat, 'utf8'));
    const atMs = Date.parse(String(heartbeat?.at || ''));
    const ageMs = Number.isFinite(atMs) ? Math.max(0, Date.now() - atMs) : Number.POSITIVE_INFINITY;
    const ready = heartbeat?.schema === 'TIGERIQ_PAPERCLIP_WSL_HEARTBEAT_V1'
      && String(heartbeat?.distro || '') === PAPERCLIP_LAB_WSL_DISTRO
      && String(heartbeat?.version || '') === BROKER_EXPECTED_VERSION
      && Number(heartbeat?.sessionId || 0) > 0
      && Boolean(String(heartbeat?.user || '').trim())
      && ageMs <= 15000;
    return { ready, user: ready ? String(heartbeat.user) : null, sessionId: ready ? Number(heartbeat.sessionId) : null, ageMs: Number.isFinite(ageMs) ? ageMs : null };
  } catch (error) {
    return { ready: false, user: null, sessionId: null, ageMs: null, reason: String(error?.code || error?.message || 'BROKER_NOT_READY') };
  }
}

export function paperclipLabBrokerOperationForDockerArgs(args = []) {
  const actual = JSON.stringify((Array.isArray(args) ? args : []).map(String));
  const allowed = [
    { operation: 'version', args: ['version', '--format', '{{.Server.Version}}'] },
    { operation: 'pull_pinned_image', args: ['pull', PAPERCLIP_LAB_IMAGE] },
    { operation: 'inspect_revision', args: ['image','inspect',PAPERCLIP_LAB_IMAGE,'--format','{{ index .Config.Labels "org.opencontainers.image.revision" }}'] },
    { operation: 'inspect_repo_digests', args: ['image','inspect',PAPERCLIP_LAB_IMAGE,'--format','{{json .RepoDigests}}'] },
    { operation: 'compose_up', args: ['compose','-f',COMPOSE_FILE,'up','-d'] },
    { operation: 'compose_stop', args: ['compose','-f',COMPOSE_FILE,'stop'] },
    { operation: 'compose_ps_all_db_json', args: ['compose','-f',COMPOSE_FILE,'ps','--all','--format','json','db'] },
    { operation: 'compose_db_logs_tail', args: ['compose','-f',COMPOSE_FILE,'logs','--no-color','--tail','120','db'] },
    { operation: 'stop_container', args: ['stop', PAPERCLIP_LAB_CONTAINER] },
    { operation: 'inspect_container', args: ['inspect', PAPERCLIP_LAB_CONTAINER, '--format', '{{json .}}'] },
    { operation: 'container_logs_tail', args: ['logs', '--tail', '160', PAPERCLIP_LAB_CONTAINER] },
  ];
  return allowed.find((item) => JSON.stringify(item.args) === actual)?.operation || null;
}

async function installInteractiveWslBroker(signal = null) {
  throwIfAborted(signal);
  await ensureLayout();
  await ensureContainedDirectory(BROKER_DIR);
  await ensureContainedDirectory(BROKER_REQUESTS_DIR);
  await ensureContainedDirectory(BROKER_RESPONSES_DIR);
  const [brokerSource, installerSource] = await Promise.all([
    fs.readFile(BROKER_SOURCE_SCRIPT, 'utf8'),
    fs.readFile(BROKER_SOURCE_INSTALLER, 'utf8'),
  ]);
  if (!brokerSource.includes("$Distro = 'Ubuntu'")
    || !brokerSource.includes("$LabRoot = 'D:\\TigerIQ-Paperclip-Lab'")
    || !installerSource.includes("$TaskName='TigerIQ Paperclip WSL Broker'")
    || !installerSource.includes("New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited")) {
    throw new Error('TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_SOURCE_INVALID');
  }
  const safeBroker = await assertSafeFileTarget(BROKER_SCRIPT_FILE);
  const safeInstaller = await assertSafeFileTarget(BROKER_INSTALLER_FILE);
  await fs.writeFile(safeBroker, brokerSource, 'utf8');
  await fs.writeFile(safeInstaller, installerSource, 'utf8');
  const result = await runFixed(
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',safeInstaller],
    { cwd: BROKER_DIR, timeoutMs: 30000, signal },
  );
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error('TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_INSTALL_FAILED');
  }
  const status = await brokerStatus();
  if (!status.ready) throw new Error('TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_HEARTBEAT_TIMEOUT');
  const probe = await runDockerViaBroker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 20000, signal });
  if (probe.exitCode !== 0 || probe.timedOut || !probe.stdout.trim()) {
    throw new Error('TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_DOCKER_UNAVAILABLE');
  }
  return {
    installed: true,
    task: 'TigerIQ Paperclip WSL Broker',
    user: status.user,
    sessionId: status.sessionId,
    brokerVersion: status.version,
    dockerVersion: probe.stdout.trim(),
  };
}

async function runDockerViaBroker(args, { timeoutMs = 120000, signal = null } = {}) {
  throwIfAborted(signal);
  const operation = paperclipLabBrokerOperationForDockerArgs(args);
  if (!operation) throw new Error('TIGERIQ_PAPERCLIP_LAB_BROKER_DOCKER_ARGS_NOT_ALLOWED');
  const status = await brokerStatus();
  if (!status.ready) throw new Error('TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_UNAVAILABLE');
  await ensureContainedDirectory(BROKER_REQUESTS_DIR);
  await ensureContainedDirectory(BROKER_RESPONSES_DIR);
  const id = randomUUID();
  const requestFile = await assertSafeFileTarget(win.join(BROKER_REQUESTS_DIR, `request-${id}.json`));
  const responseFile = await assertSafeFileTarget(win.join(BROKER_RESPONSES_DIR, `response-${id}.json`));
  await fs.writeFile(requestFile, JSON.stringify({ schema: 'TIGERIQ_PAPERCLIP_WSL_REQUEST_V1', id, operation }), { encoding: 'utf8', flag: 'wx' });
  const deadline = Date.now() + Math.max(5000, Math.min(PAPERCLIP_LAB_BROKER_MAX_WAIT_MS, Number(timeoutMs) + 10000));
  try {
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      try {
        const response = parseBrokerJson(await fs.readFile(responseFile, 'utf8'));
        if (response?.schema !== 'TIGERIQ_PAPERCLIP_WSL_RESPONSE_V1' || response?.id !== id) {
          throw new Error('TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_RESPONSE_INVALID');
        }
        await fs.rm(responseFile, { force: true });
        return {
          exitCode: Number(response?.exitCode ?? -1),
          timedOut: response?.timedOut === true,
          timeoutKind: response?.timeoutKind || null,
          stdout: clipped(response?.stdout || ''),
          stderr: clipped(response?.ok === true ? (response?.stderr || '') : (response?.stderr || 'TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_FAILED')),
        };
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await sleepWithSignal(200, signal);
    }
    return { exitCode: -1, timedOut: true, stdout: '', stderr: 'TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_TIMEOUT' };
  } finally {
    await fs.rm(requestFile, { force: true }).catch(() => {});
  }
}

async function runDocker(transport, args, options = {}) {
  if (transport === DOCKER_TRANSPORT_WINDOWS) return await runFixed('docker.exe', args, options);
  if (transport === DOCKER_TRANSPORT_WSL) return await runFixed('wsl.exe', paperclipLabWslDockerArgs(args), options);
  if (transport === DOCKER_TRANSPORT_BROKER) return await runDockerViaBroker(args, options);
  throw new Error('TIGERIQ_PAPERCLIP_LAB_DOCKER_TRANSPORT_INVALID');
}

async function resolveDockerTransport(signal = null) {
  const windows = await runFixed('docker.exe', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 15000, signal })
    .catch((error) => ({ exitCode: -1, timedOut: false, stdout: '', stderr: String(error?.message || error) }));
  if (windows.exitCode === 0 && !windows.timedOut && windows.stdout.trim()) {
    return { kind: DOCKER_TRANSPORT_WINDOWS, version: windows.stdout.trim(), error: null };
  }
  const wsl = await runFixed('wsl.exe', paperclipLabWslDockerArgs(['version', '--format', '{{.Server.Version}}']), { timeoutMs: 15000, signal })
    .catch((error) => ({ exitCode: -1, timedOut: false, stdout: '', stderr: String(error?.message || error) }));
  if (wsl.exitCode === 0 && !wsl.timedOut && wsl.stdout.trim()) {
    return { kind: DOCKER_TRANSPORT_WSL, version: wsl.stdout.trim(), error: null };
  }
  const broker = await brokerStatus();
  if (broker.ready) {
    const bridged = await runDockerViaBroker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 20000, signal })
      .catch((error) => ({ exitCode: -1, timedOut: false, stdout: '', stderr: String(error?.message || error) }));
    if (bridged.exitCode === 0 && !bridged.timedOut && bridged.stdout.trim()) {
      return { kind: DOCKER_TRANSPORT_BROKER, version: bridged.stdout.trim(), error: null, broker };
    }
    return { kind: null, version: null, error: clipped([windows.stderr, wsl.stderr, bridged.stderr].filter(Boolean).join('\n')), broker };
  }
  return {
    kind: null,
    version: null,
    error: clipped([windows.stderr, wsl.stderr, broker.reason].filter(Boolean).join('\n')),
    broker,
  };
}

function pathInsideLab(value) {
  const candidate = normalizeWinPath(value).toLowerCase();
  const base = normalizeWinPath(PAPERCLIP_LAB_ROOT).toLowerCase();
  return candidate === base || candidate.startsWith(base + '\\');
}

async function ensureRootIntegrity() {
  await fs.mkdir(PAPERCLIP_LAB_ROOT, { recursive: true });
  const stat = await fs.lstat(PAPERCLIP_LAB_ROOT);
  if (stat.isSymbolicLink()) throw new Error('TIGERIQ_PAPERCLIP_LAB_ROOT_SYMLINK_BLOCKED');
  const real = normalizeWinPath(await fs.realpath(PAPERCLIP_LAB_ROOT));
  if (real.toLowerCase() !== normalizeWinPath(PAPERCLIP_LAB_ROOT).toLowerCase()) {
    throw new Error('TIGERIQ_PAPERCLIP_LAB_REALPATH_ESCAPE_BLOCKED');
  }
  return real;
}

async function ensureContainedDirectory(value) {
  const candidate = resolvePaperclipLabPath(value);
  await fs.mkdir(candidate, { recursive: true });
  const stat = await fs.lstat(candidate);
  if (stat.isSymbolicLink()) throw new Error('TIGERIQ_PAPERCLIP_LAB_SYMLINK_BLOCKED');
  const real = normalizeWinPath(await fs.realpath(candidate));
  if (!pathInsideLab(real)) throw new Error('TIGERIQ_PAPERCLIP_LAB_REALPATH_ESCAPE_BLOCKED');
  return real;
}

async function ensureLayout() {
  await ensureRootIntegrity();
  for (const dir of [CONFIG_DIR, DATA_DIR, EVIDENCE_DIR, RESEARCH_DIR, BACKUP_DIR]) await ensureContainedDirectory(dir);
}

async function assertSafeFileTarget(value) {
  const candidate = resolvePaperclipLabPath(value);
  await ensureContainedDirectory(win.dirname(candidate));
  try {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error('TIGERIQ_PAPERCLIP_LAB_SYMLINK_BLOCKED');
    const real = normalizeWinPath(await fs.realpath(candidate));
    if (!pathInsideLab(real)) throw new Error('TIGERIQ_PAPERCLIP_LAB_REALPATH_ESCAPE_BLOCKED');
    if (!stat.isFile()) throw new Error('TIGERIQ_PAPERCLIP_LAB_FILE_REQUIRED');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return candidate;
}

export function paperclipLabComposeYaml(imageRef = PAPERCLIP_LAB_IMAGE) {
  if (imageRef !== PAPERCLIP_LAB_IMAGE && !PAPERCLIP_LAB_IMAGE_DIGEST_RE.test(imageRef)) {
    throw new Error('TIGERIQ_PAPERCLIP_LAB_IMAGE_REF_INVALID');
  }
  return [
    'name: tigeriq-paperclip-lab',
    'services:',
    '  db:',
    '    image: postgres:17-alpine',
    '    restart: "no"',
    '    environment:',
    '      POSTGRES_USER: paperclip',
    '      POSTGRES_PASSWORD: paperclip',
    '      POSTGRES_DB: paperclip',
    '    healthcheck:',
    '      test: ["CMD-SHELL", "pg_isready -U paperclip -d paperclip"]',
    '      interval: 2s',
    '      timeout: 5s',
    '      retries: 30',
    '    volumes:',
    '      - paperclip-db:/var/lib/postgresql/data',
    '  secrets-init:',
    '    image: postgres:17-alpine',
    '    restart: "no"',
    '    command: ["sh", "-c", "chmod 0700 /secrets"]',
    '    volumes:',
    '      - paperclip-secrets:/secrets',
    '  migrate:',
    `    image: ${imageRef}`,
    '    restart: "no"',
    '    environment:',
    '      DATABASE_URL: postgres://paperclip:paperclip@db:5432/paperclip',
    '    depends_on:',
    '      db:',
    '        condition: service_healthy',
    '    command: ["pnpm", "db:migrate"]',
    '  paperclip:',
    `    image: ${imageRef}`,
    `    container_name: ${PAPERCLIP_LAB_CONTAINER}`,
    '    pids_limit: 2048',
    '    restart: "no"',
    '    ports:',
    `      - "127.0.0.1:${PAPERCLIP_LAB_PORT}:3100"`,
    '    env_file:',
    '      - ./paperclip.env',
    '    environment:',
    '      DATABASE_URL: postgres://paperclip:paperclip@db:5432/paperclip',
    '    depends_on:',
    '      db:',
    '        condition: service_healthy',
    '      secrets-init:',
    '        condition: service_completed_successfully',
    '      migrate:',
    '        condition: service_completed_successfully',
    '    volumes:',
    '      - ../data:/paperclip',
    '      - paperclip-secrets:/paperclip/instances/default/secrets',
    'volumes:',
    '  paperclip-db:',
    '  paperclip-secrets:',
    '',
  ].join('\n');
}

async function ensureConfig(pin = null) {
  await ensureLayout();
  const safeEnvFile = await assertSafeFileTarget(ENV_FILE);
  let envText;
  try {
    envText = await fs.readFile(safeEnvFile, 'utf8');
    validatePaperclipLabEnvText(envText);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const authSecret = randomBytes(32).toString('hex');
    const signingSecret = randomBytes(32).toString('hex');
    envText = [
      'HOST=0.0.0.0',
      'PAPERCLIP_HOME=/paperclip',
      'PAPERCLIP_DEPLOYMENT_MODE=authenticated',
      'PAPERCLIP_DEPLOYMENT_EXPOSURE=private',
      `PAPERCLIP_PUBLIC_URL=http://localhost:${PAPERCLIP_LAB_PORT}`,
      'PAPERCLIP_ALLOWED_HOSTNAMES=localhost,127.0.0.1',
      `BETTER_AUTH_SECRET=${authSecret}`,
      `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=${signingSecret}`,
      'OPENAI_API_KEY=',
      'ANTHROPIC_API_KEY=',
      '',
    ].join('\n');
    validatePaperclipLabEnvText(envText);
    await fs.writeFile(safeEnvFile, envText, { encoding: 'utf8', flag: 'wx' });
  }
  if (!pin) return { envReady: true };
  if (pin.release !== PAPERCLIP_LAB_RELEASE || pin.sourceCommit !== PAPERCLIP_LAB_RELEASE_SHA || !PAPERCLIP_LAB_IMAGE_DIGEST_RE.test(pin.imageDigest)) {
    throw new Error('TIGERIQ_PAPERCLIP_LAB_PIN_INVALID');
  }
  const safeComposeFile = await assertSafeFileTarget(COMPOSE_FILE);
  const safeReleaseFile = await assertSafeFileTarget(RELEASE_FILE);
  await fs.writeFile(safeComposeFile, paperclipLabComposeYaml(pin.imageDigest), 'utf8');
  await fs.writeFile(safeReleaseFile, JSON.stringify({
    release: PAPERCLIP_LAB_RELEASE,
    sourceCommit: PAPERCLIP_LAB_RELEASE_SHA,
    imageTag: PAPERCLIP_LAB_IMAGE,
    imageDigest: pin.imageDigest,
    publicUrl: `http://127.0.0.1:${PAPERCLIP_LAB_PORT}`,
    exposure: 'loopback-only',
    databaseMode: 'postgres-17-sidecar',
  }, null, 2), 'utf8');
  return { envReady: true, imageDigest: pin.imageDigest };
}


async function readReleasePin() {
  const safeReleaseFile = await assertSafeFileTarget(RELEASE_FILE);
  const parsed = JSON.parse(await fs.readFile(safeReleaseFile, 'utf8'));
  const pin = {
    release: String(parsed?.release || ''),
    sourceCommit: String(parsed?.sourceCommit || ''),
    imageDigest: String(parsed?.imageDigest || ''),
  };
  if (pin.release !== PAPERCLIP_LAB_RELEASE || pin.sourceCommit !== PAPERCLIP_LAB_RELEASE_SHA || !PAPERCLIP_LAB_IMAGE_DIGEST_RE.test(pin.imageDigest)) {
    throw new Error('TIGERIQ_PAPERCLIP_LAB_PIN_INVALID');
  }
  return pin;
}

async function resolvePulledImagePin(signal = null, transport = null) {
  throwIfAborted(signal);
  const resolved = transport || (await resolveDockerTransport(signal)).kind;
  if (!resolved) throw new Error('TIGERIQ_PAPERCLIP_LAB_DOCKER_UNAVAILABLE');
  const revision = await runDocker(resolved, ['image','inspect',PAPERCLIP_LAB_IMAGE,'--format','{{ index .Config.Labels "org.opencontainers.image.revision" }}'], { timeoutMs: 15000, signal });
  if (revision.exitCode !== 0 || revision.timedOut || revision.stdout.trim() !== PAPERCLIP_LAB_RELEASE_SHA) {
    throw new Error('TIGERIQ_PAPERCLIP_LAB_IMAGE_REVISION_MISMATCH');
  }
  const digests = await runDocker(resolved, ['image','inspect',PAPERCLIP_LAB_IMAGE,'--format','{{json .RepoDigests}}'], { timeoutMs: 15000, signal });
  if (digests.exitCode !== 0 || digests.timedOut) throw new Error('TIGERIQ_PAPERCLIP_LAB_IMAGE_DIGEST_MISSING');
  let values = [];
  try { values = JSON.parse(digests.stdout.trim()); } catch {}
  const imageDigest = Array.isArray(values) ? values.find((value) => PAPERCLIP_LAB_IMAGE_DIGEST_RE.test(String(value))) : null;
  if (!imageDigest) throw new Error('TIGERIQ_PAPERCLIP_LAB_IMAGE_DIGEST_MISSING');
  return { release: PAPERCLIP_LAB_RELEASE, sourceCommit: PAPERCLIP_LAB_RELEASE_SHA, imageDigest: String(imageDigest) };
}

function composeArgs(command) {
  return ['compose', '-f', COMPOSE_FILE, ...command];
}

async function probePort(timeoutMs = 2000) {
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (reachable, reason) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ host: '127.0.0.1', port: PAPERCLIP_LAB_PORT, reachable, reason });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (error) => finish(false, error.code || 'error'));
    socket.connect(PAPERCLIP_LAB_PORT, '127.0.0.1');
  });
}

async function httpHealth(signal = null) {
  const started = Date.now();
  const timeout = AbortSignal.timeout(4000);
  const signals = signal ? [signal, timeout] : [timeout];
  const combined = AbortSignal.any(signals);
  try {
    const response = await fetch(`http://127.0.0.1:${PAPERCLIP_LAB_PORT}/api/health`, { signal: combined, headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => null);
    const appOk = response.ok && body?.status === 'ok';
    return {
      reachable: true,
      status: response.status,
      appOk,
      version: typeof body?.version === 'string' ? body.version : null,
      deploymentMode: body?.deploymentMode || null,
      deploymentExposure: body?.deploymentExposure || null,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return { reachable: false, status: null, appOk: false, elapsedMs: Date.now() - started, reason: String(error?.cause?.code || error?.name || 'fetch_error') };
  }
}

async function preflight(signal = null) {
  throwIfAborted(signal);
  await ensureRootIntegrity();
  const [docker, port] = await Promise.all([resolveDockerTransport(signal), probePort()]);
  let disk = null;
  try {
    const stat = await fs.statfs(PAPERCLIP_LAB_ROOT);
    disk = { freeBytes: Number(stat.bavail) * Number(stat.bsize), totalBytes: Number(stat.blocks) * Number(stat.bsize) };
  } catch {}
  return {
    docker: { ok: Boolean(docker.kind), transport: docker.kind, version: docker.version, error: docker.error, broker: docker.broker || await brokerStatus() },
    port3210: port,
    root: PAPERCLIP_LAB_ROOT,
    disk,
    pinned: { release: PAPERCLIP_LAB_RELEASE, sourceCommit: PAPERCLIP_LAB_RELEASE_SHA, image: PAPERCLIP_LAB_IMAGE },
  };
}

function redactPaperclipDiagnosticText(value = '') {
  return String(value || '')
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+(@)/gi, '$1[REDACTED]$2')
    .replace(/\b(authorization)\s*:\s*bearer\s+[^\s]+/gi, '$1: Bearer [REDACTED]')
    .replace(/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|COOKIE|SESSION)[A-Z0-9_]*)\s*=\s*[^\s]+/gi, '$1=[REDACTED]')
    .replace(/\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

function paperclipStructuredLogSignals(raw = '') {
  const signals = [];
  const fields = ['message','code','detail','hint','severity','constraint','table','column'];
  for (const line of String(raw || '').split('\n')) {
    let parsed;
    try { parsed = JSON.parse(line.trim()); } catch { continue; }
    const queue = [parsed?.err, parsed?.error, parsed?.cause, parsed].filter((value) => value && typeof value === 'object');
    const seen = new Set();
    while (queue.length && seen.size < 12) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current);
      for (const field of fields) {
        const value = current?.[field];
        if (typeof value === 'string' || typeof value === 'number') {
          const clippedValue = String(value).replace(/\s+/g, ' ').trim().slice(0, 520);
          if (clippedValue) signals.push(`${field}=${clippedValue}`);
        }
      }
      for (const field of ['cause','error','err']) {
        const nested = current?.[field];
        if (nested && typeof nested === 'object') queue.push(nested);
      }
    }
  }
  return [...new Set(signals.map(redactPaperclipDiagnosticText))];
}

function paperclipDiagnosticClassTriggerSignals(logClass, lines = [], structured = []) {
  const patterns = {
    DB_MIGRATION: {
      trigger: /pending migrations|stale schema|migration.*(?:failed|error)|(?:failed|error).*migration/i,
      anchor: /pending migrations|stale schema|migration|failed|error/i,
    },
    DB_CONNECTION: {
      trigger: /connection refused|could not connect|econnrefused|database system is starting up|database connection.*(?:failed|error)/i,
      anchor: /connection refused|could not connect|econnrefused|database system is starting up|database connection/i,
    },
  };
  const pattern = patterns[logClass];
  if (!pattern) return [];
  const candidates = [...lines, ...structured].filter(line => pattern.trigger.test(String(line || '')));
  return [...new Set(candidates.map((line) => {
    const text = String(line || '').trim();
    const anchor = text.search(pattern.anchor);
    const start = Math.max(0, anchor - 120);
    return text.slice(start, start + 520).trim();
  }).filter(Boolean))].slice(0, 4);
}

function paperclipBoundedDiagnosticExcerpt(selected = [], preserved = [], limit = 900) {
  const compact = selected.join('\n');
  if (compact.length <= limit) return compact;
  if (!preserved.length) return compact.slice(compact.length - limit);
  const preservedText = [...new Set(preserved)].join('\n').slice(0, Math.min(450, limit));
  const preservedSet = new Set(preserved);
  const remainder = selected.filter(line => !preservedSet.has(line)).join('\n');
  const budget = Math.max(0, limit - preservedText.length - (remainder ? 1 : 0));
  const tail = budget > 0 ? remainder.slice(Math.max(0, remainder.length - budget)) : '';
  return tail ? `${preservedText}\n${tail}` : preservedText;
}

export function paperclipContainerLogDiagnostic(value = '') {
  const raw = String(value || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
  const structured = paperclipStructuredLogSignals(raw);
  const redacted = redactPaperclipDiagnosticText(raw);
  const lines = redacted.split('\n').map(line => line.trim()).filter(Boolean);
  const logClass = paperclipContainerLogClass(raw);
  const classTrigger = paperclipDiagnosticClassTriggerSignals(logClass, lines, structured);
  const relevant = lines.filter(line => /(?:error|fail|fatal|panic|exception|database|postgres|sql|migration|permission|auth|refused|corrupt|locale|no space|out of memory|secret|token|password|authorization|does not exist|undefined table|undefined column|42p01|42703)/i.test(line));
  const selected = [...new Set([...classTrigger, ...relevant.slice(-6), ...lines.slice(-2), ...structured.slice(-8)])];
  const excerpt = paperclipBoundedDiagnosticExcerpt(selected, classTrigger, 900);
  const fingerprint = createHash('sha256').update(excerpt).digest('hex').slice(0, 24);
  return { fingerprint, excerpt };
}

export function paperclipContainerLogClass(value = '') {
  const text = String(value || '').toLowerCase();
  if (!text.trim()) return 'NO_LOGS';
  if (/permission denied|operation not permitted|\beacces\b|\beperm\b|read-only file system|must have permissions\s+0?700|secrets directory.*permissions/.test(text)) return 'PERMISSION';
  if (/better_auth_secret|tool_action_signing_secret|required env|must be set|invalid configuration|configuration error/.test(text)) return 'CONFIG';
  if (/could not create shared memory segment|shared memory.*(?:failed|error|could not)/.test(text)) return 'DB_SHARED_MEMORY';
  if (/invalid permissions|permissions should be|wrong ownership|must be owned by|not owned by.*postgres/.test(text)) return 'DB_DATA_PERMISSIONS';
  if (/data directory belongs to another instance|expected embedded data directory|refusing to reuse postgresql/.test(text)) return 'DB_DATA_DIR_MISMATCH';
  if (/database files are incompatible|not compatible with this version|pg_control version|initialized by postgresql version/.test(text)) return 'DB_VERSION_MISMATCH';
  if (/no space left on device|disk full|could not write.*(?:file|data)|input\/output error|\bi\/o error\b/.test(text)) return 'DB_STORAGE';
  if (/invalid locale|locale.*(?:not found|failed|error)|collation.*(?:failed|error)|encoding.*(?:failed|error)/.test(text)) return 'DB_LOCALE';
  if (/password authentication failed|authentication failed for user|role .* does not exist/.test(text)) return 'DB_AUTH';
  if (/failed to initialize embedded postgresql|failed to initialise embedded postgresql|\binitdb\b|initiali[sz]e.*postgres/.test(text)) return 'DB_INIT';
  if (/failed to start embedded postgresql|embedded postgresql.*(?:failed|exited)|postmaster\.pid|stale embedded postgresql lock file/.test(text)) return 'DB_START';
  if (/relation .* does not exist|column .* does not exist|undefined table|undefined column|\b42p01\b|\b42703\b/.test(text)) return 'DB_SCHEMA_MISSING';
  if (/pending migrations|stale schema|migration.*(?:failed|error)|(?:failed|error).*migration/.test(text)) return 'DB_MIGRATION';
  if (/connection refused|could not connect|econnrefused|database system is starting up|database connection.*(?:failed|error)/.test(text)) return 'DB_CONNECTION';
  if (/corrupt|invalid page|checksum.*(?:failed|error)|wal.*(?:corrupt|invalid)/.test(text)) return 'DB_CORRUPT';
  if (/database|sqlite|migration|postgres|\bsql\b/.test(text)) return 'DATABASE';
  if (/address already in use|\beaddrinuse\b|port .*in use/.test(text)) return 'PORT_CONFLICT';
  if (/out of memory|heap out of memory|\boom\b|killed process/.test(text)) return 'OOM';
  if (/no such file|cannot find module|module not found|\benoent\b|exec format/.test(text)) return 'ENTRYPOINT_OR_FILE';
  if (/fatal|uncaught|exception|\berror\b|failed/.test(text)) return 'APP_ERROR';
  return 'UNCLASSIFIED';
}

function paperclipContainerStateErrorClass(value = '') {
  const text = String(value || '').toLowerCase();
  if (!text.trim()) return 'NONE';
  if (/permission denied|operation not permitted|access denied/.test(text)) return 'PERMISSION';
  if (/mount|bind/.test(text)) return 'MOUNT';
  if (/no such file|exec format|executable file not found/.test(text)) return 'ENTRYPOINT_OR_FILE';
  if (/address already in use|port .*in use/.test(text)) return 'PORT_CONFLICT';
  return 'PRESENT';
}

export function paperclipHealthFailureClass(state = {}) {
  if (state?.ok === true) return 'OK';
  const reason = String(state?.reason || '').toUpperCase();
  if (reason === 'PIN_NOT_READY') return 'PIN_NOT_READY';
  if (reason === 'DOCKER_UNAVAILABLE') return 'DOCKER_UNAVAILABLE';
  if (state?.container?.running !== true) {
    const logClass = String(state?.container?.logClass || '');
    const stateErrorClass = String(state?.container?.stateErrorClass || '');
    if (logClass && logClass !== 'NO_LOGS' && logClass !== 'UNCLASSIFIED') return `CONTAINER_NOT_RUNNING_${logClass}`;
    if (stateErrorClass && stateErrorClass !== 'NONE') return `CONTAINER_NOT_RUNNING_STATE_${stateErrorClass}`;
    return 'CONTAINER_NOT_RUNNING';
  }
  if (state?.container?.portBindingOk !== true) return 'PORT_BINDING_MISMATCH';
  if (state?.container?.dataMountOk !== true) return 'DATA_MOUNT_MISMATCH';
  if (state?.port?.reachable !== true) return 'PORT_UNREACHABLE';
  if (state?.http?.reachable !== true) return 'HTTP_UNREACHABLE';
  if (state?.http?.status != null && Number(state.http.status) >= 400) return `HTTP_${Number(state.http.status)}`;
  if (state?.http?.appOk !== true) return 'HTTP_STATUS_NOT_OK';
  if (state?.container?.identityOk !== true) return 'IDENTITY_MISMATCH';
  return 'UNKNOWN';
}

async function waitForHealth(signal = null, transport = null) {
  const deadline = Date.now() + PAPERCLIP_LAB_HEALTH_READY_TIMEOUT_MS;
  let state = await health(signal, transport);
  while (!state.ok && Date.now() < deadline) {
    throwIfAborted(signal);
    await sleepWithSignal(PAPERCLIP_LAB_HEALTH_POLL_MS, signal);
    state = await health(signal, transport);
  }
  return state;
}


async function rollbackContainer(transport = null) {
  try {
    const resolved = transport || (await resolveDockerTransport()).kind;
    if (resolved) await runDocker(resolved, composeArgs(['stop']), { cwd: CONFIG_DIR, timeoutMs: 30000 });
  } catch {}
}

async function install(signal = null) {
  const before = await preflight(signal);
  if (!before.docker.ok || !before.docker.transport) throw new Error('TIGERIQ_PAPERCLIP_LAB_DOCKER_UNAVAILABLE');
  const transport = before.docker.transport;
  if (before.port3210.reachable) {
    const existing = await health(signal, transport);
    if (existing.ok) return { alreadyInstalled: true, preflight: before, health: existing };
    throw new Error('TIGERIQ_PAPERCLIP_LAB_PORT_3210_OCCUPIED');
  }
  await ensureConfig();
  const pull = await runDocker(transport, ['pull', PAPERCLIP_LAB_IMAGE], { timeoutMs: PAPERCLIP_LAB_PULL_TIMEOUT_MS, signal });
  if (pull.exitCode !== 0 || pull.timedOut) {
    throw new Error(`TIGERIQ_PAPERCLIP_LAB_PULL_FAILED_${paperclipDockerFailureClass(pull)}`);
  }
  const pin = await resolvePulledImagePin(signal, transport);
  await ensureConfig(pin);
  try {
    const up = await runDocker(transport, composeArgs(['up', '-d']), { cwd: CONFIG_DIR, timeoutMs: 120000, signal });
    if (up.exitCode !== 0 || up.timedOut) throw new Error('TIGERIQ_PAPERCLIP_LAB_START_FAILED');
    const state = await waitForHealth(signal, transport);
    if (!state.ok) {
      const diagnostic = await health(signal, transport, { diagnostics: true }).catch(() => state);
      throw new Error(`TIGERIQ_PAPERCLIP_LAB_HEALTH_TIMEOUT_${paperclipHealthFailureClass(diagnostic)}`);
    }
    return { installed: true, dockerTransport: transport, imageDigest: pin.imageDigest, pull: { exitCode: pull.exitCode }, start: { exitCode: up.exitCode }, health: state };
  } catch (error) {
    await rollbackContainer(transport);
    throw error;
  }
}
async function start(signal = null) {
  const pin = await readReleasePin();
  const docker = await resolveDockerTransport(signal);
  if (!docker.kind) throw new Error('TIGERIQ_PAPERCLIP_LAB_DOCKER_UNAVAILABLE');
  await ensureConfig(pin);
  try {
    const up = await runDocker(docker.kind, composeArgs(['up', '-d']), { cwd: CONFIG_DIR, timeoutMs: 120000, signal });
    if (up.exitCode !== 0 || up.timedOut) throw new Error('TIGERIQ_PAPERCLIP_LAB_START_FAILED');
    const state = await waitForHealth(signal, docker.kind);
    if (!state.ok) {
      const diagnostic = await health(signal, docker.kind, { diagnostics: true }).catch(() => state);
      throw new Error(`TIGERIQ_PAPERCLIP_LAB_HEALTH_TIMEOUT_${paperclipHealthFailureClass(diagnostic)}`);
    }
    return { started: true, dockerTransport: docker.kind, imageDigest: pin.imageDigest, health: state };
  } catch (error) {
    await rollbackContainer(docker.kind);
    throw error;
  }
}
async function stop(signal = null) {
  const pin = await readReleasePin();
  throwIfAborted(signal);
  const docker = await resolveDockerTransport(signal);
  if (!docker.kind) throw new Error('TIGERIQ_PAPERCLIP_LAB_DOCKER_UNAVAILABLE');
  const down = await runDocker(docker.kind, composeArgs(['stop']), { cwd: CONFIG_DIR, timeoutMs: 60000, signal });
  if (down.exitCode !== 0 || down.timedOut) throw new Error('TIGERIQ_PAPERCLIP_LAB_STOP_FAILED');
  return { stopped: true, dockerTransport: docker.kind, imageDigest: pin.imageDigest, port3210: await probePort() };
}
function mountSourceMatchesLabData(source) {
  const value = String(source || '').replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '');
  return [
    'd:/tigeriq-paperclip-lab/data',
    '/run/desktop/mnt/host/d/tigeriq-paperclip-lab/data',
    '/host_mnt/d/tigeriq-paperclip-lab/data',
    '/mnt/d/tigeriq-paperclip-lab/data',
  ].includes(value);
}

export function parsePaperclipComposePsRows(value = '') {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter((row) => row && typeof row === 'object');
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {}
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) rows.push(...parsed.filter((row) => row && typeof row === 'object'));
      else if (parsed && typeof parsed === 'object') rows.push(parsed);
    } catch {}
  }
  return rows;
}

async function inspectComposeService(dockerKind, service, signal = null, diagnostics = false) {
  if (service !== 'db') throw new Error('TIGERIQ_PAPERCLIP_LAB_DIAGNOSTIC_SERVICE_NOT_ALLOWED');
  const psResult = await runDocker(
    dockerKind,
    composeArgs(['ps', '--all', '--format', 'json', 'db']),
    { cwd: CONFIG_DIR, timeoutMs: 15000, signal },
  ).catch(() => null);
  const rows = psResult?.exitCode === 0 ? parsePaperclipComposePsRows(psResult.stdout) : [];
  const row = rows.find((item) => String(item?.Service || '').toLowerCase() === 'db') || rows[0] || null;
  if (!row) {
    return {
      present: false,
      running: false,
      status: null,
      exitCode: null,
      oomKilled: null,
      healthStatus: null,
      restartCount: null,
      startedAt: null,
      finishedAt: null,
      stateErrorClass: 'NONE',
      logClass: diagnostics ? 'LOGS_UNAVAILABLE' : null,
      logFingerprint: null,
      logExcerpt: null,
    };
  }

  let logClass = null;
  let logDiagnostic = null;
  if (diagnostics) {
    const logs = await runDocker(
      dockerKind,
      composeArgs(['logs', '--no-color', '--tail', '120', 'db']),
      { cwd: CONFIG_DIR, timeoutMs: 20000, signal },
    ).catch(() => null);
    if (logs?.exitCode === 0) {
      const combinedLogs = `${logs.stdout || ''}\n${logs.stderr || ''}`;
      logClass = paperclipContainerLogClass(combinedLogs);
      logDiagnostic = paperclipContainerLogDiagnostic(combinedLogs);
    } else {
      logClass = 'LOGS_UNAVAILABLE';
    }
  }
  const state = String(row?.State || row?.Status || '').trim();
  const exitCode = Number(row?.ExitCode);
  return {
    present: true,
    running: /^running$/i.test(state),
    status: state || null,
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    oomKilled: null,
    healthStatus: String(row?.Health || '').trim() || null,
    restartCount: null,
    startedAt: null,
    finishedAt: null,
    stateErrorClass: 'NONE',
    logClass,
    logFingerprint: logDiagnostic?.fingerprint || null,
    logExcerpt: logDiagnostic?.excerpt || null,
  };
}

async function health(signal = null, transport = null, options = {}) {
  throwIfAborted(signal);
  let pin;
  try { pin = await readReleasePin(); }
  catch { return { ok: false, url: `http://127.0.0.1:${PAPERCLIP_LAB_PORT}`, reason: 'PIN_NOT_READY' }; }

  const docker = transport ? { kind: transport, version: null, error: null } : await resolveDockerTransport(signal);
  if (!docker.kind) return { ok: false, url: `http://127.0.0.1:${PAPERCLIP_LAB_PORT}`, reason: 'DOCKER_UNAVAILABLE', docker };
  const [port, http, inspect, database] = await Promise.all([
    probePort(),
    httpHealth(signal),
    runDocker(docker.kind, ['inspect', PAPERCLIP_LAB_CONTAINER, '--format', '{{json .}}'], { timeoutMs: 15000, signal }).catch(() => null),
    inspectComposeService(docker.kind, 'db', signal, options?.diagnostics === true),
  ]);

  let info = null;
  try { info = inspect?.exitCode === 0 ? JSON.parse(inspect.stdout.trim()) : null; } catch {}
  const ports = info?.NetworkSettings?.Ports?.['3100/tcp'];
  const portBindingOk = Array.isArray(ports)
    && ports.length === 1
    && String(ports[0]?.HostIp || '') === '127.0.0.1'
    && String(ports[0]?.HostPort || '') === String(PAPERCLIP_LAB_PORT);
  const mounts = Array.isArray(info?.Mounts) ? info.Mounts : [];
  const dataMounts = mounts.filter((m) => String(m?.Destination || '') === '/paperclip');
  const dataMountOk = dataMounts.length === 1
    && String(dataMounts[0]?.Type || '') === 'bind'
    && dataMounts[0]?.RW === true
    && mountSourceMatchesLabData(dataMounts[0]?.Source);
  const secretsMounts = mounts.filter((m) => String(m?.Destination || '') === '/paperclip/instances/default/secrets');
  const secretsMountOk = secretsMounts.length === 1
    && String(secretsMounts[0]?.Type || '') === 'volume'
    && secretsMounts[0]?.RW === true
    && String(secretsMounts[0]?.Name || '') === 'tigeriq-paperclip-lab_paperclip-secrets';
  const labels = info?.Config?.Labels || {};
  const identityOk = Boolean(
    info?.State?.Running === true
    && String(info?.Config?.Image || '') === pin.imageDigest
    && String(labels['com.docker.compose.project'] || '') === 'tigeriq-paperclip-lab'
    && String(labels['com.docker.compose.service'] || '') === 'paperclip'
    && String(info?.HostConfig?.RestartPolicy?.Name || '') === 'no'
    && Number(info?.HostConfig?.PidsLimit) === 2048
    && portBindingOk
    && dataMountOk
    && secretsMountOk
  );

  let logClass = null;
  let logDiagnostic = null;
  if (options?.diagnostics === true && info && info?.State?.Running !== true) {
    const logs = await runDocker(
      docker.kind,
      ['logs', '--tail', '160', PAPERCLIP_LAB_CONTAINER],
      { timeoutMs: 20000, signal },
    ).catch(() => null);
    if (logs?.exitCode === 0) {
      const combinedLogs = `${logs.stdout || ''}\n${logs.stderr || ''}`;
      logClass = paperclipContainerLogClass(combinedLogs);
      logDiagnostic = paperclipContainerLogDiagnostic(combinedLogs);
    } else {
      logClass = 'LOGS_UNAVAILABLE';
    }
  }
  const containerDiagnostic = {
    status: typeof info?.State?.Status === 'string' ? info.State.Status : null,
    exitCode: Number.isInteger(info?.State?.ExitCode) ? info.State.ExitCode : null,
    oomKilled: info?.State?.OOMKilled === true,
    stateErrorClass: paperclipContainerStateErrorClass(info?.State?.Error),
    logClass,
    logFingerprint: logDiagnostic?.fingerprint || null,
    logExcerpt: logDiagnostic?.excerpt || null,
  };

  const state = {
    ok: port.reachable && http.appOk === true && identityOk,
    url: `http://127.0.0.1:${PAPERCLIP_LAB_PORT}`,
    port,
    http,
    container: {
      running: info?.State?.Running === true,
      identityOk,
      portBindingOk,
      dataMountOk,
      secretsMountOk,
      imageDigest: info?.Config?.Image || null,
      ...containerDiagnostic,
    },
    docker: { transport: docker.kind, version: docker.version || null },
    pinned: { release: PAPERCLIP_LAB_RELEASE, sourceCommit: PAPERCLIP_LAB_RELEASE_SHA, imageDigest: pin.imageDigest },
  };
  state.result = {
    healthFailureClass: paperclipHealthFailureClass(state),
    portReachable: state.port?.reachable === true,
    httpReachable: state.http?.reachable === true,
    httpStatus: state.http?.status ?? null,
    httpAppOk: state.http?.appOk === true,
    container: {
      running: state.container?.running === true,
      status: state.container?.status || null,
      exitCode: state.container?.exitCode ?? null,
      oomKilled: state.container?.oomKilled === true,
      stateErrorClass: state.container?.stateErrorClass || null,
      logClass: state.container?.logClass || null,
      logFingerprint: state.container?.logFingerprint || null,
      logExcerpt: state.container?.logExcerpt || null,
      portBindingOk: state.container?.portBindingOk === true,
      dataMountOk: state.container?.dataMountOk === true,
      secretsMountOk: state.container?.secretsMountOk === true,
      identityOk: state.container?.identityOk === true,
    },
    database: {
      present: database?.present === true,
      running: database?.running === true,
      status: database?.status || null,
      exitCode: database?.exitCode ?? null,
      oomKilled: database?.oomKilled ?? null,
      healthStatus: database?.healthStatus || null,
      restartCount: database?.restartCount ?? null,
      startedAt: database?.startedAt || null,
      finishedAt: database?.finishedAt || null,
      stateErrorClass: database?.stateErrorClass || null,
      logClass: database?.logClass || null,
      logFingerprint: database?.logFingerprint || null,
      logExcerpt: database?.logExcerpt || null,
    },
  };
  return state;
}
export async function executePaperclipLabAction(input = {}, options = {}) {
  const signal = options?.signal || null;
  throwIfAborted(signal);
  const { action } = assertPaperclipLabRequest(input);
  const started = Date.now();
  let data;
  if (action === 'paperclip_lab_preflight') data = await preflight(signal);
  else if (action === 'paperclip_lab_broker_install') data = await installInteractiveWslBroker(signal);
  else if (action === 'paperclip_lab_install') data = await install(signal);
  else if (action === 'paperclip_lab_start') data = await start(signal);
  else if (action === 'paperclip_lab_stop') data = await stop(signal);
  else if (action === 'paperclip_lab_health') data = await health(signal, null, { diagnostics: true });
  else throw new Error('TIGERIQ_PAPERCLIP_LAB_ACTION_NOT_ALLOWED');
  return {
    data,
    evidence: {
      capability: 'paperclip-lab-v2',
      runtimeRevision: PAPERCLIP_LAB_RUNTIME_REVISION,
      root: PAPERCLIP_LAB_ROOT,
      port: PAPERCLIP_LAB_PORT,
      loopbackOnly: true,
      arbitraryShell: false,
      arbitraryPath: false,
      arbitraryPort: false,
      pinnedRelease: PAPERCLIP_LAB_RELEASE,
      pinnedSourceCommit: PAPERCLIP_LAB_RELEASE_SHA,
      pinnedImageTag: PAPERCLIP_LAB_IMAGE,
      pinnedImageDigest: data?.imageDigest || data?.health?.pinned?.imageDigest || data?.pinned?.imageDigest || null,
      dockerTransport: data?.dockerTransport || data?.docker?.transport || data?.health?.docker?.transport || data?.preflight?.docker?.transport || null,
      elapsedMs: Date.now() - started,
    },
  };
}
