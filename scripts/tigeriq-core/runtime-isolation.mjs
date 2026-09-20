import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';

let isolatedPath = null;
let gatedSHA = null;

function verifyCleanWorkTree() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() }).trim();
    if (status) throw new Error('Working tree is dirty');
  } catch (e) {
    throw new Error(`Dirty check failed: ${e.message}`);
  }
}

export function setupIsolation(rootRepo, sha) {
  verifyCleanWorkTree();
  const tempDir = join(dirname(rootRepo), 'tigeriq-isolated-wt-' + Math.random().toString(36).substring(2, 8));
  try {
    execSync(`git worktree add -f ${tempDir} --checkout ${sha}`, { cwd: rootRepo, encoding: 'utf8' });
    isolatedPath = tempDir;
    gatedSHA = sha;
    const runtimeDir = join(tempDir, '.runtime');
    if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
    const meta = { gatedSHA, timestamp: new Date().toISOString(), branch: 'main', rootRepo };
    writeFileSync(join(runtimeDir, 'isolation-meta.json'), JSON.stringify(meta, null, 2));
    return tempDir;
  } catch (e) {
    cleanup();
    throw e;
  }
}

export function getIsolatedPath() {
  if (!isolatedPath) throw new Error('Isolation not setup');
  return isolatedPath;
}

export function getGatedSHA() {
  return gatedSHA;
}

export function cleanup() {
  if (isolatedPath) {
    try { rmSync(isolatedPath, { recursive: true, force: true }); } catch {}
    isolatedPath = null;
  }
}
