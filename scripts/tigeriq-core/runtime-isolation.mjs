import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve repo root from scripts/tigeriq-core up to repository root
const REPO_ROOT = resolve(__dirname, '../..');
const RUNTIME_DIR = join(REPO_ROOT, '.runtime');
const META_PATH = join(RUNTIME_DIR, 'isolation-meta.json');

let activeWorktreePath = null;
let gatedShaValue = null;

function sanitizeError(msg) {
  if (!msg) return 'UNKNOWN_ERROR';
  return String(msg).replace(/[A-Za-z]:\\[^\s:]+/g, '[REDACTED_PATH]').replace(/\/[^\s:]+\/[^\s:]+/g, '[REDACTED_PATH]');
}

function runGit(args, cwd = REPO_ROOT) {
  try {
    return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.trim() : err.message;
    throw new Error(`GIT_FAILED: git ${args} -> ${sanitizeError(stderr)}`);
  }
}

function makeReadOnly(dir) {
  try {
    const entries = execSync(`git ls-files`, { cwd: dir, encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (existsSync(fullPath)) {
        try {
          chmodSync(fullPath, 0o444);
        } catch {}
      }
    }
  } catch {}
}

export function verifyCleanWorkingTree() {
  const status = runGit('status --porcelain');
  if (status.length > 0) {
    throw new Error('DIRTY_WORKING_TREE: Active development branch has uncommitted changes.');
  }
}

export function getIsolatedPath() {
  if (activeWorktreePath && existsSync(activeWorktreePath)) {
    return activeWorktreePath;
  }

  verifyCleanWorkingTree();

  const branch = runGit('rev-parse --abbrev-ref HEAD');
  if (branch === 'main' || branch === 'master') {
    throw new Error('INVALID_BRANCH: Cannot create isolated worktree while directly on main/master.');
  }

  gatedShaValue = runGit('rev-parse origin/main');
  if (!gatedShaValue) {
    throw new Error('RESOLVE_MAIN_SHA_FAILED: Could not resolve origin/main commit SHA.');
  }

  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
  }

  const worktreeDir = join(RUNTIME_DIR, `worktree-${Date.now()}`);
  
  try {
    runGit(`worktree add --detach ${worktreeDir} ${gatedShaValue}`);
    activeWorktreePath = resolve(worktreeDir);

    makeReadOnly(activeWorktreePath);

    const meta = {
      gatedSha: gatedShaValue,
      devBranch: branch,
      worktreePath: activeWorktreePath,
      createdAt: new Date().toISOString()
    };
    writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf8');

    return activeWorktreePath;
  } catch (err) {
    cleanup();
    throw new Error(`ISOLATED_CHECKOUT_FAILED: ${sanitizeError(err.message)}`);
  }
}

export function getGatedSHA() {
  if (gatedShaValue) {
    return gatedShaValue;
  }
  if (existsSync(META_PATH)) {
    try {
      const data = JSON.parse(readFileSync(META_PATH, 'utf8'));
      if (data && data.gatedSha) {
        gatedShaValue = data.gatedSha;
        return gatedShaValue;
      }
    } catch {}
  }
  return runGit('rev-parse origin/main');
}

export function cleanup() {
  if (activeWorktreePath) {
    try {
      const entries = execSync(`git ls-files`, { cwd: activeWorktreePath, encoding: 'utf8' }).split('\n').filter(Boolean);
      for (const entry of entries) {
        const fullPath = join(activeWorktreePath, entry);
        if (existsSync(fullPath)) {
          try {
            chmodSync(fullPath, 0o666);
          } catch {}
        }
      }
    } catch {}
    try {
      runGit(`worktree remove --force ${activeWorktreePath}`);
    } catch {
      if (existsSync(activeWorktreePath)) {
        try {
          rmSync(activeWorktreePath, { recursive: true, force: true });
        } catch {}
      }
    }
    activeWorktreePath = null;
  }
  if (existsSync(META_PATH)) {
    try {
      rmSync(META_PATH, { force: true });
    } catch {}
  }
}
