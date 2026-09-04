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
  queueResilience?: 'READY' | 'REPAIRED' | 'UNKNOWN';
  controllerDiagnose?: 'READY' | 'REPAIRED' | 'UNKNOWN';
  controllerRuntime?: 'READY' | 'REPAIRED' | 'UNKNOWN';
  repairScript?: string;
  queueRepairScript?: string;
  controllerDiagnoseRepairScript?: string;
  controllerRuntimeRepairScript?: string;
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
const QUEUE_RESILIENCE_MARKER = '# TIGERIQ_QUEUE_RESILIENCE_V1';

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

function hasReadyRoles(workerText: string): boolean {
  return workerText.includes(NEW_REVIEWER) && workerText.includes(NEW_JUDGE);
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
  const queueRepairScript = resolve(repoRoot, 'scripts', 'pc-worker', 'repair-secure-worker-queue-resilience.ps1');
  const controllerDiagnoseRepairScript = resolve(repoRoot, 'scripts', 'pc-worker', 'repair-control-plane-controller-diagnose.ps1');
  const controllerRuntimeRepairScript = resolve(repoRoot, 'scripts', 'pc-worker', 'repair-workforce-controller-runtime-deps.ps1');

  try {
    let workerText = await readFile(workerImpl, 'utf8');
    const oldRoles = workerText.includes(OLD_REVIEWER) || workerText.includes(OLD_JUDGE);
    const readyRoles = hasReadyRoles(workerText);
    if (!oldRoles && !readyRoles) throw new Error('WORKER_LAYOUT_CHANGED');

    let modelRoles: 'READY' | 'REPAIRED' = readyRoles ? 'READY' : 'REPAIRED';
    let queueResilience: 'READY' | 'REPAIRED' = workerText.includes(QUEUE_RESILIENCE_MARKER) ? 'READY' : 'REPAIRED';
    let controllerDiagnose: 'READY' | 'REPAIRED' = 'READY';
    let controllerRuntime: 'READY' | 'REPAIRED' = 'READY';
    let repaired = false;

    if (oldRoles) {
      await readFile(repairScript, 'utf8');
      const result = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', repairScript,
        '-Repo', options.repo, '-SkipCanary',
      ], 3 * 60 * 1000);
      if (!result.stdout.includes('"status":"PASS"') && !result.stdout.includes('"status": "PASS"')) {
        throw new Error(`MODEL_ROLE_REPAIR_NO_PASS: ${clipped(result.stdout || result.stderr)}`);
      }
      repaired = true;
      modelRoles = 'REPAIRED';
      workerText = await readFile(workerImpl, 'utf8');
      if (!hasReadyRoles(workerText)) throw new Error('ROLE_PATCH_NOT_PERSISTED');
    }

    if (!workerText.includes(QUEUE_RESILIENCE_MARKER)) {
      await readFile(queueRepairScript, 'utf8');
      const result = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', queueRepairScript,
        '-Repo', options.repo,
      ], 3 * 60 * 1000);
      if (!result.stdout.includes('"status":"PASS"') && !result.stdout.includes('"status": "PASS"')) {
        throw new Error(`QUEUE_RESILIENCE_REPAIR_NO_PASS: ${clipped(result.stdout || result.stderr)}`);
      }
      repaired = true;
      queueResilience = 'REPAIRED';
      workerText = await readFile(workerImpl, 'utf8');
      if (!workerText.includes(QUEUE_RESILIENCE_MARKER)) throw new Error('QUEUE_PATCH_NOT_PERSISTED');
    }

    await readFile(controllerDiagnoseRepairScript, 'utf8');
    const diagnoseRepair = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', controllerDiagnoseRepairScript,
    ], 3 * 60 * 1000);
    if (!diagnoseRepair.stdout.includes('"status":"PASS"') && !diagnoseRepair.stdout.includes('"status": "PASS"')) {
      throw new Error(`CONTROLLER_DIAGNOSE_REPAIR_NO_PASS: ${clipped(diagnoseRepair.stdout || diagnoseRepair.stderr)}`);
    }
    if (/"patched"\s*:\s*true/i.test(diagnoseRepair.stdout)) {
      repaired = true;
      controllerDiagnose = 'REPAIRED';
    }

    await readFile(controllerRuntimeRepairScript, 'utf8');
    const runtimeRepair = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', controllerRuntimeRepairScript,
    ], 5 * 60 * 1000);
    if (!runtimeRepair.stdout.includes('"status":"PASS"') && !runtimeRepair.stdout.includes('"status": "PASS"')) {
      throw new Error(`CONTROLLER_RUNTIME_REPAIR_NO_PASS: ${clipped(runtimeRepair.stdout || runtimeRepair.stderr)}`);
    }
    if (/"runtime"\s*:\s*"REPAIRED"/i.test(runtimeRepair.stdout)) {
      repaired = true;
      controllerRuntime = 'REPAIRED';
    }

    if (!hasReadyRoles(workerText)) throw new Error('ROLE_PATCH_NOT_PERSISTED');

    if (repaired) {
      const state: RuntimeSelfHealState = {
        result: 'REPAIRED', updatedAt: timestamp(), workerTask: 'Running', modelRoles, queueResilience, controllerDiagnose, controllerRuntime,
        repairScript, queueRepairScript, controllerDiagnoseRepairScript, controllerRuntimeRepairScript,
      };
      await save(statePath, state);
      return state;
    }

    const fixed = "$t=Get-ScheduledTask -TaskName 'TigerIQ Worker' -ErrorAction Stop; if($t.State -ne 'Running'){ Start-ScheduledTask -TaskName 'TigerIQ Worker' -ErrorAction Stop; Start-Sleep -Seconds 2 }; $t=Get-ScheduledTask -TaskName 'TigerIQ Worker' -ErrorAction Stop; [Console]::Out.Write([string]$t.State)";
    const status = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', fixed], 30_000);
    if (!/Running/i.test(status.stdout)) throw new Error(`WORKER_TASK_NOT_RUNNING: ${clipped(status.stdout || status.stderr)}`);
    const state: RuntimeSelfHealState = {
      result: 'READY', updatedAt: timestamp(), workerTask: 'Running', modelRoles: 'READY', queueResilience: 'READY', controllerDiagnose: 'READY', controllerRuntime: 'READY',
      repairScript, queueRepairScript, controllerDiagnoseRepairScript, controllerRuntimeRepairScript,
    };
    await save(statePath, state);
    return state;
  } catch (error) {
    const state: RuntimeSelfHealState = {
      result: 'FAILED', updatedAt: timestamp(), modelRoles: 'UNKNOWN', queueResilience: 'UNKNOWN', controllerDiagnose: 'UNKNOWN', controllerRuntime: 'UNKNOWN',
      repairScript, queueRepairScript, controllerDiagnoseRepairScript, controllerRuntimeRepairScript,
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
