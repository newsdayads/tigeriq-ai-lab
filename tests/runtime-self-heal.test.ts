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
  await writeFile(join(scriptDir, 'repair-control-plane-controller-diagnose.ps1'), '# reviewed diagnose repair fixture', 'utf8');
  return { root, worker, state };
}

describe('PC01 runtime self-heal', () => {
  it('never mutates Worker while artifact updater runs localhost candidate health', async () => {
    const f = await fixture(oldRoles);
    let calls = 0;
    const result = await selfHealPc01Runtime({ host: '127.0.0.1', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state, run: async () => { calls += 1; return { stdout: '', stderr: '' }; } });
    expect(result.result).toBe('SKIPPED');
    expect(calls).toBe(0);
  });

  it('ensures the allowlisted TigerIQ Worker task is running when all repair markers are ready', async () => {
    const f = await fixture(`${readyRoles}\n${queueMarker}`);
    const calls: Array<{ file: string; args: string[] }> = [];
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (file, args) => {
        calls.push({ file, args });
        const joined=args.join(' ');
        if(joined.includes('-File') && joined.includes('repair-control-plane-controller-diagnose.ps1')) return {stdout:'{"status":"PASS","diagnose":"READY","patched":false}',stderr:''};
        return { stdout: 'Running', stderr: '' };
      },
    });
    expect(result.result).toBe('READY');
    expect(result.workerTask).toBe('Running');
    expect(result.queueResilience).toBe('READY');
    expect(result.controllerDiagnose).toBe('READY');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args.join(' ')).toContain('repair-control-plane-controller-diagnose.ps1');
    expect(calls[1]?.args.join(' ')).toContain('TigerIQ Worker');
  });

  it('repairs deterministic-command queue resilience and installs diagnose action', async () => {
    const f = await fixture(readyRoles);
    const calls: Array<{ file: string; args: string[]; timeout: number }> = [];
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (file, args, timeout) => {
        calls.push({ file, args, timeout });
        const joined=args.join(' ');
        if (joined.includes('repair-secure-worker-queue-resilience.ps1')) await writeFile(f.worker, `${readyRoles}\n${queueMarker}`, 'utf8');
        if (joined.includes('repair-control-plane-controller-diagnose.ps1')) return { stdout: '{"status":"PASS","diagnose":"REPAIRED","patched":true}', stderr: '' };
        return { stdout: '[100%]\n{"status":"PASS"}', stderr: '' };
      },
    });
    expect(result.result).toBe('REPAIRED');
    expect(result.modelRoles).toBe('READY');
    expect(result.queueResilience).toBe('REPAIRED');
    expect(result.controllerDiagnose).toBe('READY');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args.join(' ')).toContain('repair-secure-worker-queue-resilience.ps1');
    expect(calls[1]?.args.join(' ')).toContain('repair-control-plane-controller-diagnose.ps1');
  });

  it('repairs missing model roles first, then queue resilience, then installs diagnose action', async () => {
    const f = await fixture(oldRoles);
    const calls: Array<{ file: string; args: string[]; timeout: number }> = [];
    const result = await selfHealPc01Runtime({
      host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state,
      run: async (file, args, timeout) => {
        calls.push({ file, args, timeout });
        const joined = args.join(' ');
        if (joined.includes('repair-secure-worker-model-roles.ps1')) await writeFile(f.worker, readyRoles, 'utf8');
        if (joined.includes('repair-secure-worker-queue-resilience.ps1')) await writeFile(f.worker, `${readyRoles}\n${queueMarker}`, 'utf8');
        if (joined.includes('repair-control-plane-controller-diagnose.ps1')) return { stdout: '{"status":"PASS","diagnose":"REPAIRED","patched":true}', stderr: '' };
        return { stdout: '[100%]\n{"status":"PASS"}', stderr: '' };
      },
    });
    expect(result.result).toBe('REPAIRED');
    expect(result.modelRoles).toBe('REPAIRED');
    expect(result.queueResilience).toBe('REPAIRED');
    expect(result.controllerDiagnose).toBe('READY');
    expect(calls).toHaveLength(3);
    expect(calls[0]?.args.join(' ')).toContain('repair-secure-worker-model-roles.ps1');
    expect(calls[0]?.args).toContain('-SkipCanary');
    expect(calls[1]?.args.join(' ')).toContain('repair-secure-worker-queue-resilience.ps1');
    expect(calls[2]?.args.join(' ')).toContain('repair-control-plane-controller-diagnose.ps1');
  });
});
