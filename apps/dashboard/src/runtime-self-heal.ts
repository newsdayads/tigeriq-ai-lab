import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type RuntimeSelfHealState = {
  result: 'SKIPPED' | 'READY' | 'REPAIRED' | 'FAILED';
  updatedAt: string;
  workerTask?: string;
  modelRoles?: 'READY' | 'REPAIRED' | 'UNKNOWN';
  repairScript?: string;
  error?: string;
};

export interface RuntimeSelfHealOptions {
  host: string;
  repo: string;
  repoRoot?: string;
  workerImpl?: string;
  statePath?: string;
  run?: (file: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;
}

const OLD_REVIEWER = "REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', '').strip()";
const NEW_REVIEWER = "REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', 'qwen3:8b').strip()";
const OLD_JUDGE = "JUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', '').strip()";
const NEW_JUDGE = "JUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', 'gemma3:4b').strip()";

function livePc01Host(host: string): boolean {
  return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
}

async function defaultRun(file: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(file, args, {
    timeout: timeoutMs,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function save(path: string, state: RuntimeSelfHealState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8');
}

function clipped(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 800);
}

export async function selfHealPc01Runtime(options: RuntimeSelfHealOptions): Promise<RuntimeSelfHealState> {
  const statePath = options.statePath ?? 'F:\\TigerIQ\\CommandCenter\\worker-self-heal-v1.json';
  const timestamp = () => new Date().toISOString();
  if (!livePc01Host(options.host) || process.env.TIGERIQ_DISABLE_RUNTIME_SELF_HEAL === '1') {
    const state: RuntimeSelfHealState = { result: 'SKIPPED', updatedAt: timestamp(), error: 'candidate_or_disabled' };
    await save(statePath, state).catch(() => undefined);
    return state;
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) {
    const state: RuntimeSelfHealState = { result: 'FAILED', updatedAt: timestamp(), error: 'invalid_repo' };
    await save(statePath, state).catch(() => undefined);
    return state;
  }

  const run = options.run ?? defaultRun;
  const repoRoot = options.repoRoot ?? process.env.TIGERIQ_REPO_ROOT ?? process.cwd();
  const workerImpl = options.workerImpl ?? 'F:\\TigerIQ\\Worker\\worker_impl.py';
  const repairScript = resolve(repoRoot, 'scripts', 'pc-worker', 'repair-secure-worker-model-roles.ps1');

  try {
    const workerText = await readFile(workerImpl, 'utf8');
    const oldRoles = workerText.includes(OLD_REVIEWER) || workerText.includes(OLD_JUDGE);
    const readyRoles = workerText.includes(NEW_REVIEWER) && workerText.includes(NEW_JUDGE);
    if (!oldRoles && !readyRoles) throw new Error('WORKER_LAYOUT_CHANGED');

    if (oldRoles) {
      await readFile(repairScript, 'utf8');
      const result = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', repairScript,
        '-Repo', options.repo, '-SkipCanary',
      ], 3 * 60 * 1000);
      if (!result.stdout.includes('"status":"PASS"') && !result.stdout.includes('"status": "PASS"')) {
        throw new Error(`MODEL_ROLE_REPAIR_NO_PASS: ${clipped(result.stdout || result.stderr)}`);
      }
      const state: RuntimeSelfHealState = {
        result: 'REPAIRED', updatedAt: timestamp(), workerTask: 'Running', modelRoles: 'REPAIRED', repairScript,
      };
      await save(statePath, state);
      return state;
    }

    const fixed = "$t=Get-ScheduledTask -TaskName 'TigerIQ Worker' -ErrorAction Stop; if($t.State -ne 'Running'){ Start-ScheduledTask -TaskName 'TigerIQ Worker' -ErrorAction Stop; Start-Sleep -Seconds 2 }; $t=Get-ScheduledTask -TaskName 'TigerIQ Worker' -ErrorAction Stop; [Console]::Out.Write([string]$t.State)";
    const status = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', fixed], 30_000);
    if (!/Running/i.test(status.stdout)) throw new Error(`WORKER_TASK_NOT_RUNNING: ${clipped(status.stdout || status.stderr)}`);
    const state: RuntimeSelfHealState = { result: 'READY', updatedAt: timestamp(), workerTask: 'Running', modelRoles: 'READY', repairScript };
    await save(statePath, state);
    return state;
  } catch (error) {
    const state: RuntimeSelfHealState = {
      result: 'FAILED', updatedAt: timestamp(), modelRoles: 'UNKNOWN', repairScript,
      error: clipped(error instanceof Error ? error.message : error),
    };
    await save(statePath, state).catch(() => undefined);
    return state;
  }
}

export function schedulePc01RuntimeSelfHeal(options: RuntimeSelfHealOptions): void {
  if (!livePc01Host(options.host) || process.env.TIGERIQ_DISABLE_RUNTIME_SELF_HEAL === '1') return;
  const timer = setTimeout(() => { void selfHealPc01Runtime(options); }, 2_000);
  timer.unref();
}
