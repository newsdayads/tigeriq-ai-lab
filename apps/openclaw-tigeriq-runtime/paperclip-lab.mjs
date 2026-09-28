import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const win = path.win32;
export const PAPERCLIP_LAB_ROOT = 'D:\\TigerIQ-Paperclip-Lab';
export const PAPERCLIP_LAB_PORT = 3210;
export const PAPERCLIP_LAB_RELEASE = 'v2026.916.1';
export const PAPERCLIP_LAB_RELEASE_SHA = 'd554c4789ed3930f8a53ac9fdf6503b3187097da';
export const PAPERCLIP_LAB_IMAGE = 'ghcr.io/paperclipai/paperclip:2026.916.1';
export const PAPERCLIP_LAB_CONTAINER = 'tigeriq-paperclip-lab';
export const PAPERCLIP_LAB_ACTIONS = Object.freeze([
  'paperclip_lab_preflight',
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

function baseEnv() {
  const env = {};
  for (const key of ['SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.DOCKER_CLI_HINTS = 'false';
  return env;
}

async function runFixed(exe, args, { cwd = PAPERCLIP_LAB_ROOT, timeoutMs = 120000 } = {}) {
  const safeCwd = resolvePaperclipLabPath(cwd);
  await fs.mkdir(safeCwd, { recursive: true });
  return await new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: safeCwd,
      windowsHide: true,
      env: baseEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: typeof code === 'number' ? code : -1, timedOut, stdout: clipped(stdout), stderr: clipped(stderr) });
    });
  });
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

export function paperclipLabComposeYaml() {
  return [
    'name: tigeriq-paperclip-lab',
    'services:',
    '  paperclip:',
    `    image: ${PAPERCLIP_LAB_IMAGE}`,
    `    container_name: ${PAPERCLIP_LAB_CONTAINER}`,
    '    pids_limit: 2048',
    '    restart: "no"',
    '    ports:',
    `      - "127.0.0.1:${PAPERCLIP_LAB_PORT}:3100"`,
    '    env_file:',
    '      - ./paperclip.env',
    '    volumes:',
    '      - ../data:/paperclip',
    '',
  ].join('\n');
}

async function ensureConfig() {
  await ensureLayout();
  try {
    await fs.access(ENV_FILE);
  } catch {
    const authSecret = randomBytes(32).toString('hex');
    const signingSecret = randomBytes(32).toString('hex');
    const envText = [
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
    await fs.writeFile(ENV_FILE, envText, { encoding: 'utf8', flag: 'wx' });
  }
  await fs.writeFile(COMPOSE_FILE, paperclipLabComposeYaml(), 'utf8');
  await fs.writeFile(RELEASE_FILE, JSON.stringify({
    release: PAPERCLIP_LAB_RELEASE,
    sourceCommit: PAPERCLIP_LAB_RELEASE_SHA,
    image: PAPERCLIP_LAB_IMAGE,
    publicUrl: `http://127.0.0.1:${PAPERCLIP_LAB_PORT}`,
    exposure: 'loopback-only',
  }, null, 2), 'utf8');
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

async function httpHealth() {
  const started = Date.now();
  try {
    const response = await fetch(`http://127.0.0.1:${PAPERCLIP_LAB_PORT}/`, { signal: AbortSignal.timeout(4000), redirect: 'manual' });
    return { reachable: true, status: response.status, elapsedMs: Date.now() - started };
  } catch (error) {
    return { reachable: false, status: null, elapsedMs: Date.now() - started, reason: String(error?.cause?.code || error?.name || 'fetch_error') };
  }
}

async function preflight() {
  await ensureRootIntegrity();
  const [docker, port] = await Promise.all([
    runFixed('docker.exe', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 15000 }).catch((error) => ({ exitCode: -1, timedOut: false, stdout: '', stderr: String(error?.message || error) })),
    probePort(),
  ]);
  let disk = null;
  try {
    const stat = await fs.statfs(PAPERCLIP_LAB_ROOT);
    disk = { freeBytes: Number(stat.bavail) * Number(stat.bsize), totalBytes: Number(stat.blocks) * Number(stat.bsize) };
  } catch {}
  return {
    docker: { ok: docker.exitCode === 0 && !docker.timedOut, version: docker.stdout.trim() || null, error: docker.exitCode === 0 ? null : clipped(docker.stderr) },
    port3210: port,
    root: PAPERCLIP_LAB_ROOT,
    disk,
    pinned: { release: PAPERCLIP_LAB_RELEASE, sourceCommit: PAPERCLIP_LAB_RELEASE_SHA, image: PAPERCLIP_LAB_IMAGE },
  };
}

async function install() {
  const before = await preflight();
  if (!before.docker.ok) throw new Error('TIGERIQ_PAPERCLIP_LAB_DOCKER_UNAVAILABLE');
  if (before.port3210.reachable) {
    const existing = await health();
    if (existing.ok) return { alreadyInstalled: true, preflight: before, health: existing };
    throw new Error('TIGERIQ_PAPERCLIP_LAB_PORT_3210_OCCUPIED');
  }
  await ensureConfig();
  const pull = await runFixed('docker.exe', ['pull', PAPERCLIP_LAB_IMAGE], { timeoutMs: 180000 });
  if (pull.exitCode !== 0 || pull.timedOut) throw new Error('TIGERIQ_PAPERCLIP_LAB_PULL_FAILED');
  const up = await runFixed('docker.exe', composeArgs(['up', '-d']), { cwd: CONFIG_DIR, timeoutMs: 120000 });
  if (up.exitCode !== 0 || up.timedOut) throw new Error('TIGERIQ_PAPERCLIP_LAB_START_FAILED');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await health();
    if (state.ok) return { installed: true, pull: { exitCode: pull.exitCode }, start: { exitCode: up.exitCode }, health: state };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('TIGERIQ_PAPERCLIP_LAB_HEALTH_TIMEOUT');
}

async function start() {
  await ensureConfig();
  const up = await runFixed('docker.exe', composeArgs(['up', '-d']), { cwd: CONFIG_DIR, timeoutMs: 120000 });
  if (up.exitCode !== 0 || up.timedOut) throw new Error('TIGERIQ_PAPERCLIP_LAB_START_FAILED');
  return { started: true, health: await health() };
}

async function stop() {
  await ensureConfig();
  const down = await runFixed('docker.exe', composeArgs(['stop']), { cwd: CONFIG_DIR, timeoutMs: 60000 });
  if (down.exitCode !== 0 || down.timedOut) throw new Error('TIGERIQ_PAPERCLIP_LAB_STOP_FAILED');
  return { stopped: true, port3210: await probePort() };
}

async function health() {
  const [port, http, ps] = await Promise.all([
    probePort(),
    httpHealth(),
    fs.access(COMPOSE_FILE).then(() => runFixed('docker.exe', composeArgs(['ps', '--format', 'json']), { cwd: CONFIG_DIR, timeoutMs: 15000 })).catch(() => null),
  ]);
  const output = ps ? clipped(ps.stdout).slice(0, 8000) : '';
  const identityOk = Boolean(ps && ps.exitCode === 0 && output.includes(PAPERCLIP_LAB_CONTAINER) && output.includes(PAPERCLIP_LAB_IMAGE));
  const containerSummary = ps ? { ok: ps.exitCode === 0, identityOk, output, error: ps.exitCode === 0 ? null : clipped(ps.stderr).slice(0, 2000) } : { ok: false, identityOk: false, output: '', error: 'NOT_CONFIGURED' };
  return {
    ok: port.reachable && http.reachable && http.status >= 200 && http.status < 500 && identityOk,
    url: `http://127.0.0.1:${PAPERCLIP_LAB_PORT}`,
    port,
    http,
    container: containerSummary,
    pinned: { release: PAPERCLIP_LAB_RELEASE, sourceCommit: PAPERCLIP_LAB_RELEASE_SHA, image: PAPERCLIP_LAB_IMAGE },
  };
}

export async function executePaperclipLabAction(input = {}) {
  const { action } = assertPaperclipLabRequest(input);
  const started = Date.now();
  let data;
  if (action === 'paperclip_lab_preflight') data = await preflight();
  else if (action === 'paperclip_lab_install') data = await install();
  else if (action === 'paperclip_lab_start') data = await start();
  else if (action === 'paperclip_lab_stop') data = await stop();
  else if (action === 'paperclip_lab_health') data = await health();
  else throw new Error('TIGERIQ_PAPERCLIP_LAB_ACTION_NOT_ALLOWED');
  return {
    data,
    evidence: {
      capability: 'paperclip-lab-v1',
      root: PAPERCLIP_LAB_ROOT,
      port: PAPERCLIP_LAB_PORT,
      loopbackOnly: true,
      arbitraryShell: false,
      arbitraryPath: false,
      arbitraryPort: false,
      pinnedRelease: PAPERCLIP_LAB_RELEASE,
      pinnedSourceCommit: PAPERCLIP_LAB_RELEASE_SHA,
      pinnedImage: PAPERCLIP_LAB_IMAGE,
      elapsedMs: Date.now() - started,
    },
  };
}
