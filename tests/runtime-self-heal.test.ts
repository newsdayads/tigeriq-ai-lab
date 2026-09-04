import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { selfHealPc01Runtime } from '../apps/dashboard/src/runtime-self-heal.js';

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function fixture(workerText: string) {
  const root = await mkdtemp(join(tmpdir(), 'tigeriq-self-heal-'));
  roots.push(root);
  const worker = join(root, 'worker_impl.py');
  const state = join(root, 'state', 'worker-self-heal-v1.json');
  const scriptDir = join(root, 'scripts', 'pc-worker');
  await mkdir(scriptDir, { recursive: true });
  await writeFile(worker, workerText, 'utf8');
  await writeFile(join(scriptDir, 'repair-secure-worker-model-roles.ps1'), '# reviewed repair fixture', 'utf8');
  return { root, worker, state };
}

describe('PC01 runtime self-heal', () => {
  it('never mutates Worker while artifact updater runs localhost candidate health', async () => {
    const f = await fixture("REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', '').strip()\nJUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', '').strip()");
    let calls = 0;
    const result = await selfHealPc01Runtime({ host: '127.0.0.1', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state, run: async () => { calls += 1; return { stdout: '', stderr: '' }; } });
    expect(result.result).toBe('SKIPPED');
    expect(calls).toBe(0);
  });

  it('ensures the allowlisted TigerIQ Worker task is running when model roles are already configured', async () => {
    const f = await fixture("REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', 'qwen3:8b').strip()\nJUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', 'gemma3:4b').strip()");
    const calls: Array<{ file: string; args: string[] }> = [];
    const result = await selfHealPc01Runtime({ host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state, run: async (file, args) => { calls.push({ file, args }); return { stdout: 'Running', stderr: '' }; } });
    expect(result.result).toBe('READY');
    expect(result.workerTask).toBe('Running');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe('powershell.exe');
    expect(calls[0]?.args.join(' ')).toContain('TigerIQ Worker');
    const state = JSON.parse(await readFile(f.state, 'utf8')) as { result: string };
    expect(state.result).toBe('READY');
  });

  it('invokes only the reviewed repair script when reviewer/judge roles are still empty', async () => {
    const f = await fixture("REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', '').strip()\nJUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', '').strip()");
    const calls: Array<{ file: string; args: string[]; timeout: number }> = [];
    const result = await selfHealPc01Runtime({ host: '100.97.23.87', repo: 'newsdayads/tigeriq-ai-lab', repoRoot: f.root, workerImpl: f.worker, statePath: f.state, run: async (file, args, timeout) => { calls.push({ file, args, timeout }); return { stdout: '[100%]\n{"status":"PASS"}', stderr: '' }; } });
    expect(result.result).toBe('REPAIRED');
    expect(result.modelRoles).toBe('REPAIRED');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain('-File');
    expect(calls[0]?.args.join(' ')).toContain('repair-secure-worker-model-roles.ps1');
    expect(calls[0]?.args).toContain('newsdayads/tigeriq-ai-lab');
  });
});
