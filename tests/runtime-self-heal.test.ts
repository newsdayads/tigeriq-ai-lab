import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { selfHealPc01Runtime } from '../apps/dashboard/src/runtime-self-heal.js';

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

const readyRoles = "REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', 'qwen3:8b').strip()\nJUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', 'gemma3:4b').strip()";
const oldRoles = "REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', '').strip()\nJUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', '').strip()";
const queueMarker = '# TIGERIQ_QUEUE_RESILIENCE_V1';
const zeroTouchReady = '{"status":"READY","deploy":"READY","physical":"CONFIRMED","reload_mode":"CHROME_UI_VERSION_CONFIRMED","mutated":false}';

async function fixture(workerText: string) {
  const root = await mkdtemp(join(tmpdir(), 'tigeriq-self-heal-'));
  roots.push(root);
  const worker = join(root, 'worker_impl.py');
  const state = join(root, 'state', 'worker-self-heal-v1.json');
  const scriptDir = join(root, 'scripts', 'pc-worker');
  await mkdir(scriptDir, { recursive: true });
  await writeFile(worker, workerText, 'utf8');
  await writeFile(join(scriptDir, 'repair-secure-worker-model-roles.ps1'), '# reviewed model repair fixture', 'utf8');
  await writeFile(join(scriptDir, 'repair-secure-worker-queue-resilience.ps1'), '# reviewed queue repair fixture', 'utf8');
  await writeFile(join(scriptDir, 'install-autoworker-zero-touch-hook.ps1'), '# reviewed zero-touch Auto Worker fixture', 'utf8');
  await writeFile(join(scriptDir, 'hide-worker-watchdog-console.ps1'), '# reviewed watchdog repair fixture', 'utf8');
  await writeFile(join(scriptDir, 'repair-control-plane-controller-diagnose.ps1'), '# reviewed diagnose repair fixture', 'utf8');
  await writeFile(join(scriptDir, 'repair-workforce-controller-runtime-deps.ps1'), '# reviewed controller runtime repair fixture', 'utf8');
  return { root, worker, state };
}

describe('PC01 runtime self-heal', () => {
  it('never mutates Worker, Watchdog or Controller while artifact updater runs localhost candidate health', async () => {
    const f = await fixture(oldRoles);
    let calls = 0;
    const result = await selfHealPc01Runtime({ host: '127.0.0.1', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state, run: async () => { calls += 1; return { stdout: '', stderr: '' }; } });
    expect(result.result).toBe('SKIPPED');
    expect(calls).toBe(0);
  });

  it('keeps zero-touch Auto Worker and an already-hidden Watchdog READY before Controller + Worker health', async () => {
    const f = await fixture(`${readyRoles}\n${queueMarker}`);
    const calls: Array<{ file: string; args: string[] }> = [];
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (file, args) => {
        calls.push({ file, args });
        const joined = args.join(' ');
        if (joined.includes('install-autoworker-zero-touch-hook.ps1')) return { stdout: zeroTouchReady, stderr: '' };
        if (joined.includes('hide-worker-watchdog-console.ps1')) return { stdout: '{"status":"READY","mutated":false,"principalPreserved":true,"triggerPreserved":true,"physicalVerified":false}', stderr: '' };
        if (joined.includes('repair-control-plane-controller-diagnose.ps1')) return { stdout: '{"status":"PASS","diagnose":"READY","patched":false}', stderr: '' };
        if (joined.includes('repair-workforce-controller-runtime-deps.ps1')) return { stdout: '{"status":"PASS","runtime":"READY","pgImport":true,"http":true,"postgres":true,"migration":"001_operational_state_v1"}', stderr: '' };
        return { stdout: 'Running', stderr: '' };
      },
    });
    expect(result.result).toBe('READY');
    expect(result.workerTask).toBe('Running');
    expect(result.queueResilience).toBe('READY');
    expect(result.autoWorkerDeploy).toBe('READY');
    expect(result.autoWorkerPhysical).toBe('CONFIRMED');
    expect(result.watchdogConsole).toBe('READY');
    expect(result.controllerDiagnose).toBe('READY');
    expect(result.controllerRuntime).toBe('READY');
    expect(calls).toHaveLength(5);
    expect(calls[0]?.args.join(' ')).toContain('install-autoworker-zero-touch-hook.ps1');
    expect(calls[0]?.args).toContain('-Apply');
    expect(calls[1]?.args.join(' ')).toContain('hide-worker-watchdog-console.ps1');
    expect(calls[1]?.args).toContain('-Apply');
    expect(calls[2]?.args.join(' ')).toContain('repair-control-plane-controller-diagnose.ps1');
    expect(calls[3]?.args.join(' ')).toContain('repair-workforce-controller-runtime-deps.ps1');
    expect(calls[4]?.args.join(' ')).toContain('TigerIQ Worker');
  });

  it('runs zero-touch Auto Worker before repairing queue resilience', async () => {
    const f = await fixture(readyRoles);
    const calls: Array<{ file: string; args: string[]; timeout: number }> = [];
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (file, args, timeout) => {
        calls.push({ file, args, timeout });
        const joined = args.join(' ');
        if (joined.includes('install-autoworker-zero-touch-hook.ps1')) return { stdout: zeroTouchReady, stderr: '' };
        if (joined.includes('repair-secure-worker-queue-resilience.ps1')) {
          await writeFile(f.worker, `${readyRoles}\n${queueMarker}`, 'utf8');
          return { stdout: '{"status":"PASS"}', stderr: '' };
        }
        if (joined.includes('hide-worker-watchdog-console.ps1')) return { stdout: '{"status":"PASS","mutated":true,"principalPreserved":true,"triggerPreserved":true,"physicalVerified":false}', stderr: '' };
        if (joined.includes('repair-control-plane-controller-diagnose.ps1')) return { stdout: '{"status":"PASS","diagnose":"REPAIRED","patched":true}', stderr: '' };
        if (joined.includes('repair-workforce-controller-runtime-deps.ps1')) return { stdout: '{"status":"PASS","runtime":"READY","pgImport":true,"http":true,"postgres":true,"migration":"001_operational_state_v1"}', stderr: '' };
        return { stdout: '[100%]\n{"status":"PASS"}', stderr: '' };
      },
    });
    expect(result.result).toBe('REPAIRED');
    expect(result.modelRoles).toBe('READY');
    expect(result.queueResilience).toBe('REPAIRED');
    expect(result.autoWorkerDeploy).toBe('READY');
    expect(result.autoWorkerPhysical).toBe('CONFIRMED');
    expect(result.watchdogConsole).toBe('REPAIRED');
    expect(result.controllerDiagnose).toBe('REPAIRED');
    expect(result.controllerRuntime).toBe('READY');
    expect(calls).toHaveLength(5);
    expect(calls[0]?.args.join(' ')).toContain('install-autoworker-zero-touch-hook.ps1');
    expect(calls[0]?.args).toContain('-Apply');
    expect(calls[1]?.args.join(' ')).toContain('repair-secure-worker-queue-resilience.ps1');
    expect(calls[2]?.args.join(' ')).toContain('hide-worker-watchdog-console.ps1');
    expect(calls[2]?.args).toContain('-Apply');
    expect(calls[3]?.args.join(' ')).toContain('repair-control-plane-controller-diagnose.ps1');
    expect(calls[4]?.args.join(' ')).toContain('repair-workforce-controller-runtime-deps.ps1');
  });

  it('runs zero-touch Auto Worker before model-role and queue repairs', async () => {
    const f = await fixture(oldRoles);
    const calls: Array<{ file: string; args: string[]; timeout: number }> = [];
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (file, args, timeout) => {
        calls.push({ file, args, timeout });
        const joined = args.join(' ');
        if (joined.includes('install-autoworker-zero-touch-hook.ps1')) return { stdout: zeroTouchReady, stderr: '' };
        if (joined.includes('repair-secure-worker-model-roles.ps1')) {
          await writeFile(f.worker, readyRoles, 'utf8');
          return { stdout: '{"status":"PASS"}', stderr: '' };
        }
        if (joined.includes('repair-secure-worker-queue-resilience.ps1')) {
          await writeFile(f.worker, `${readyRoles}\n${queueMarker}`, 'utf8');
          return { stdout: '{"status":"PASS"}', stderr: '' };
        }
        if (joined.includes('hide-worker-watchdog-console.ps1')) return { stdout: '{"status":"PASS","mutated":true,"principalPreserved":true,"triggerPreserved":true,"physicalVerified":false}', stderr: '' };
        if (joined.includes('repair-control-plane-controller-diagnose.ps1')) return { stdout: '{"status":"PASS","diagnose":"REPAIRED","patched":true}', stderr: '' };
        if (joined.includes('repair-workforce-controller-runtime-deps.ps1')) return { stdout: '{"status":"PASS","runtime":"REPAIRED","pgImport":true,"http":true,"postgres":true,"migration":"001_operational_state_v1"}', stderr: '' };
        return { stdout: '[100%]\n{"status":"PASS"}', stderr: '' };
      },
    });
    expect(result.result).toBe('REPAIRED');
    expect(result.modelRoles).toBe('REPAIRED');
    expect(result.queueResilience).toBe('REPAIRED');
    expect(result.autoWorkerDeploy).toBe('READY');
    expect(result.autoWorkerPhysical).toBe('CONFIRMED');
    expect(result.watchdogConsole).toBe('REPAIRED');
    expect(result.controllerDiagnose).toBe('REPAIRED');
    expect(result.controllerRuntime).toBe('REPAIRED');
    expect(calls).toHaveLength(6);
    expect(calls[0]?.args.join(' ')).toContain('install-autoworker-zero-touch-hook.ps1');
    expect(calls[0]?.args).toContain('-Apply');
    expect(calls[1]?.args.join(' ')).toContain('repair-secure-worker-model-roles.ps1');
    expect(calls[1]?.args).toContain('-SkipCanary');
    expect(calls[2]?.args.join(' ')).toContain('repair-secure-worker-queue-resilience.ps1');
    expect(calls[3]?.args.join(' ')).toContain('hide-worker-watchdog-console.ps1');
    expect(calls[4]?.args.join(' ')).toContain('repair-control-plane-controller-diagnose.ps1');
    expect(calls[5]?.args.join(' ')).toContain('repair-workforce-controller-runtime-deps.ps1');
  });

  it('still attempts zero-touch Auto Worker when legacy Worker layout is incompatible', async () => {
    const f = await fixture('UNRELATED_WORKER_LAYOUT_V9');
    const calls: string[] = [];
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (_file, args) => {
        calls.push(args.join(' '));
        if (args.join(' ').includes('install-autoworker-zero-touch-hook.ps1')) return { stdout: zeroTouchReady, stderr: '' };
        return { stdout: 'Running', stderr: '' };
      },
    });
    expect(result.result).toBe('FAILED');
    expect(result.autoWorkerDeploy).toBe('READY');
    expect(result.autoWorkerPhysical).toBe('CONFIRMED');
    expect(result.error).toContain('WORKER_LAYOUT_CHANGED');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('install-autoworker-zero-touch-hook.ps1');
    const persisted = JSON.parse(await readFile(f.state, 'utf8')) as { autoWorkerDeploy: string; autoWorkerPhysical: string; error: string };
    expect(persisted.autoWorkerDeploy).toBe('READY');
    expect(persisted.autoWorkerPhysical).toBe('CONFIRMED');
    expect(persisted.error).toContain('WORKER_LAYOUT_CHANGED');
  });

  it('fails closed before Watchdog when zero-touch Auto Worker deploy does not return PASS or READY', async () => {
    const f = await fixture(`${readyRoles}\n${queueMarker}`);
    let calls = 0;
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (_file, args) => {
        calls += 1;
        if (args.join(' ').includes('install-autoworker-zero-touch-hook.ps1')) return { stdout: '{"status":"FAIL","deploy":"FAILED","physical":"UNKNOWN"}', stderr: '' };
        return { stdout: 'Running', stderr: '' };
      },
    });
    expect(result.result).toBe('FAILED');
    expect(result.autoWorkerDeploy).toBe('UNKNOWN');
    expect(result.watchdogConsole).toBe('UNKNOWN');
    expect(calls).toBe(1);
    const persisted = JSON.parse(await readFile(f.state, 'utf8')) as { result: string; error: string };
    expect(persisted.result).toBe('FAILED');
    expect(persisted.error).toContain('AUTOWORKER_ZERO_TOUCH_DEPLOY_NO_PASS');
  });

  it('fails closed when Watchdog repair does not return PASS or READY', async () => {
    const f = await fixture(`${readyRoles}\n${queueMarker}`);
    let calls = 0;
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (_file, args) => {
        calls += 1;
        const joined = args.join(' ');
        if (joined.includes('install-autoworker-zero-touch-hook.ps1')) return { stdout: zeroTouchReady, stderr: '' };
        if (joined.includes('hide-worker-watchdog-console.ps1')) return { stdout: '{"status":"FAIL","error":"WATCHDOG_ARGUMENTS_UNEXPECTED"}', stderr: '' };
        return { stdout: 'Running', stderr: '' };
      },
    });
    expect(result.result).toBe('FAILED');
    expect(result.autoWorkerDeploy).toBe('READY');
    expect(result.autoWorkerPhysical).toBe('CONFIRMED');
    expect(result.watchdogConsole).toBe('UNKNOWN');
    expect(calls).toBe(2);
    const persisted = JSON.parse(await readFile(f.state, 'utf8')) as { result: string; error: string; autoWorkerDeploy: string };
    expect(persisted.result).toBe('FAILED');
    expect(persisted.autoWorkerDeploy).toBe('READY');
    expect(persisted.error).toContain('WATCHDOG_CONSOLE_REPAIR_NO_PASS');
  });

  it('fails closed when Controller runtime health does not pass after zero-touch Auto Worker and Watchdog are READY', async () => {
    const f = await fixture(`${readyRoles}\n${queueMarker}`);
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (_file, args) => {
        const joined = args.join(' ');
        if (joined.includes('install-autoworker-zero-touch-hook.ps1')) return { stdout: zeroTouchReady, stderr: '' };
        if (joined.includes('hide-worker-watchdog-console.ps1')) return { stdout: '{"status":"READY","mutated":false}', stderr: '' };
        if (joined.includes('repair-control-plane-controller-diagnose.ps1')) return { stdout: '{"status":"PASS","diagnose":"READY","patched":false}', stderr: '' };
        if (joined.includes('repair-workforce-controller-runtime-deps.ps1')) return { stdout: '{"status":"FAIL","error":"CONTROLLER_LISTENER_NOT_READY"}', stderr: '' };
        return { stdout: 'Running', stderr: '' };
      },
    });
    expect(result.result).toBe('FAILED');
    expect(result.autoWorkerDeploy).toBe('READY');
    expect(result.autoWorkerPhysical).toBe('CONFIRMED');
    expect(result.controllerRuntime).toBe('UNKNOWN');
    const persisted = JSON.parse(await readFile(f.state, 'utf8')) as { result: string; error: string; autoWorkerDeploy: string };
    expect(persisted.result).toBe('FAILED');
    expect(persisted.autoWorkerDeploy).toBe('READY');
    expect(persisted.error).toContain('CONTROLLER_RUNTIME_REPAIR_NO_PASS');
  });
});
