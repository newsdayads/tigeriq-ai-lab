import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patchDesktopCommanderServer, verifyDesktopCommanderServerPatched } from './patch-desktop-commander.mjs';
import { patchRemoteLauncher, verifyRemoteLauncherPatched } from './patch-remote-launcher.mjs';

export const DESKTOP_COMMANDER_VERSION = '0.2.51';
export const DEFAULT_RUNTIME_ROOT = 'D:\\TigerIQ\\Runtime\\desktop-commander-remote';
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));

function runtimeLayout(runtimeRoot = DEFAULT_RUNTIME_ROOT) {
  const appRoot = path.join(runtimeRoot, 'app-' + DESKTOP_COMMANDER_VERSION);
  const packageRoot = path.join(appRoot, 'node_modules', '@wonderwhy-er', 'desktop-commander');
  const distRoot = path.join(packageRoot, 'dist');
  const guardRoot = path.join(distRoot, 'tigeriq-remote-guard');
  return {
    runtimeRoot,
    appRoot,
    packageRoot,
    distRoot,
    guardRoot,
    packageJson: path.join(packageRoot, 'package.json'),
    policy: path.join(guardRoot, 'policy.mjs'),
    runtimeGate: path.join(guardRoot, 'runtime-gate.mjs'),
    server: path.join(distRoot, 'server.js'),
    launcher: path.join(runtimeRoot, 'start-desktop-commander-remote.ps1'),
  };
}

async function readUtf8(file) {
  return fs.readFile(file, 'utf8');
}

async function atomicWrite(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + '.tigeriq-tmp-' + process.pid + '-' + Date.now();
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, target);
}

function checkJsSyntax(file) {
  const run = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (run.status !== 0) {
    const detail = String(run.stderr || run.stdout || '').trim().slice(0, 500);
    throw new Error('RDC_GUARD_SYNTAX_INVALID:' + path.basename(file) + ':' + detail);
  }
}

async function stageAndCheck(target, content) {
  const ext = path.extname(target) || '.mjs';
  const base = target.slice(0, target.length - ext.length);
  const tmp = base + '.tigeriq-stage-' + process.pid + '-' + Date.now() + ext;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tmp, content, 'utf8');
  try {
    checkJsSyntax(tmp);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

export async function installRemoteDesktopGuard({
  runtimeRoot = DEFAULT_RUNTIME_ROOT,
  sourceDir = SELF_DIR,
  failAfterWrites = Number.POSITIVE_INFINITY,
} = {}) {
  const layout = runtimeLayout(runtimeRoot);
  const pkg = JSON.parse(await readUtf8(layout.packageJson));
  if (String(pkg.version || '') !== DESKTOP_COMMANDER_VERSION) {
    throw new Error('RDC_VERSION_MISMATCH:' + String(pkg.version || 'unknown'));
  }

  const sourcePolicy = await readUtf8(path.join(sourceDir, 'policy.mjs'));
  const sourceRuntimeGate = await readUtf8(path.join(sourceDir, 'runtime-gate.mjs'));
  if (!sourcePolicy.includes("AUTHORIZATION_TOOL = 'tigeriq_authorize_mutation'")) {
    throw new Error('RDC_AUTHORIZER_SOURCE_MISSING');
  }
  if (!sourceRuntimeGate.includes('installOwnerLeaseFromAuthorization')) {
    throw new Error('RDC_RUNTIME_GATE_AUTHORIZER_MISSING');
  }

  const currentServer = await readUtf8(layout.server);
  const currentLauncher = await readUtf8(layout.launcher);
  const nextServer = patchDesktopCommanderServer(currentServer);
  const nextLauncher = patchRemoteLauncher(currentLauncher);
  if (!verifyDesktopCommanderServerPatched(nextServer)) throw new Error('RDC_SERVER_PATCH_VERIFY_FAILED');
  if (!verifyRemoteLauncherPatched(nextLauncher)) throw new Error('RDC_LAUNCHER_PATCH_VERIFY_FAILED');

  await stageAndCheck(layout.server, nextServer);
  await stageAndCheck(layout.policy, sourcePolicy);
  await stageAndCheck(layout.runtimeGate, sourceRuntimeGate);

  const desired = [
    { key: 'policy', target: layout.policy, content: sourcePolicy },
    { key: 'runtimeGate', target: layout.runtimeGate, content: sourceRuntimeGate },
    { key: 'server', target: layout.server, content: nextServer },
    { key: 'launcher', target: layout.launcher, content: nextLauncher, syntax: false },
  ];

  const originals = new Map();
  const changes = [];
  for (const item of desired) {
    let current = null;
    try { current = await readUtf8(item.target); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    originals.set(item.target, current);
    if (current !== item.content) changes.push(item);
  }

  if (!changes.length) {
    return { ok: true, changed: false, version: DESKTOP_COMMANDER_VERSION, changes: [] };
  }

  const applied = [];
  try {
    let writeCount = 0;
    for (const item of changes) {
      const original = originals.get(item.target);
      if (original !== null) {
        await fs.writeFile(item.target + '.tigeriq-v4.bak', original, 'utf8');
      }
      if (writeCount >= failAfterWrites) throw new Error('TEST_INJECTED_WRITE_FAILURE');
      await atomicWrite(item.target, item.content);
      writeCount++;
      applied.push(item);
    }
  } catch (error) {
    for (const item of applied.reverse()) {
      const original = originals.get(item.target);
      try {
        if (original === null) await fs.rm(item.target, { force: true });
        else await atomicWrite(item.target, original);
      } catch {
        // Fail closed: retain primary error, never hide partial rollback evidence.
      }
    }
    throw new Error('RDC_GUARD_INSTALL_ROLLED_BACK:' + String(error?.message || error));
  }

  return {
    ok: true,
    changed: true,
    version: DESKTOP_COMMANDER_VERSION,
    changes: changes.map((item) => item.key),
    authorizer: 'tigeriq_authorize_mutation',
  };
}

async function main() {
  try {
    const result = await installRemoteDesktopGuard();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, error: String(error?.message || error) }) + '\n');
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) await main();
