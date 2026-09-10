import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hot = JSON.parse(readFileSync('docs/HOT_STATE.json', 'utf8'));

describe('HOT STATE fast-start contract', () => {
  it('is a derived index and preserves authoritative source pointers', () => {
    expect(hot.authoritativeByItself).toBe(false);
    expect(hot.kind).toBe('derived_fast_start_index');
    expect(hot.dynamicPointers).toMatchObject({ centralRouterIssue: 280, interactionPolicyIssue: 504, commandRegistryIssue: 335, sourceTruthIssue: 556 });
  });

  it('resolves current priority and the latest browser Owner hold without deep history', () => {
    expect(hot.currentPriority).toMatchObject({ issue: 556, owner: 'NV02 / Khoa' });
    expect(hot.currentDecisions.chatgptWebAutomation).toMatchObject({ status: 'OWNER_HOLD', sourceIssue: 549, sourceCommentId: 5609639273 });
    expect(hot.completed).toEqual(expect.arrayContaining([401, 509, 524]));
  });

  it('excludes stale snapshots and old worktrees/releases from current resolution', () => {
    expect(hot.excludedFromCurrentResolution).toEqual(expect.arrayContaining(['stale_pc01_worktrees','stale_pc01_releases','repo_docs_company_v1_as_runtime_authority']));
  });

  it('CLI validates and fails closed on an invalid state file', () => {
    const ok = JSON.parse(execFileSync(process.execPath, ['scripts/resolve-hot-state.mjs', '--check'], { encoding: 'utf8' }));
    expect(ok).toMatchObject({ ok: true, hotStateVersion: hot.hotStateVersion });
    const dir = mkdtempSync(join(tmpdir(), 'tigeriq-hot-state-'));
    const invalid = join(dir, 'bad.json');
    writeFileSync(invalid, JSON.stringify({ schemaVersion: 1 }), 'utf8');
    const failed = spawnSync(process.execPath, ['scripts/resolve-hot-state.mjs', '--check'], { encoding: 'utf8', env: { ...process.env, TIGERIQ_HOT_STATE: invalid } });
    expect(failed.status).toBe(2);
    expect(failed.stderr).toContain('HOT_STATE_INVALID');
  });
});
