import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { withCoreManagerPgLock } from '../apps/tigeriq-core/manager-singleton-pg-lock.mjs';

function poolFake({ acquire = true, unlock = true } = {}) {
  const released = [], statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: acquire }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: unlock }] };
      throw Error('UNEXPECTED_SQL');
    },
    release(force) { released.push(force === true); },
  };
  return { pool: { connect: async () => client }, released, statements };
}

describe('#4457 cross-process Core manager tick lease guard', () => {
  it('holds the PostgreSQL session lock until the whole manager tick has settled', async () => {
    const { pool, released, statements } = poolFake();
    let ran = false;
    const result = await withCoreManagerPgLock(pool, async () => { ran = true; return 42; });
    expect(result).toEqual({ admitted: true, outcome: 42 });
    expect(ran).toBe(true);
    expect(statements[0]).toContain('pg_try_advisory_lock');
    expect(statements[1]).toContain('pg_advisory_unlock');
    expect(released).toEqual([false]);
  });

  it('never dispatches when another OS process owns the manager tick', async () => {
    const { pool, released, statements } = poolFake({ acquire: false });
    let ran = false;
    const result = await withCoreManagerPgLock(pool, async () => { ran = true; });
    expect(result).toEqual({ admitted: false });
    expect(ran).toBe(false);
    expect(statements).toHaveLength(1);
    expect(released).toEqual([false]);
  });

  it('releases the lock on manager failure, preserving the actual error', async () => {
    const { pool, released, statements } = poolFake();
    await expect(withCoreManagerPgLock(pool, async () => { throw Error('MANAGER_FAILED'); }))
      .rejects.toThrow('MANAGER_FAILED');
    expect(statements).toHaveLength(2);
    expect(released).toEqual([false]);
  });

  it('destroys the database connection when unlock cannot be confirmed', async () => {
    const { pool, released } = poolFake({ unlock: false });
    await expect(withCoreManagerPgLock(pool, async () => true))
      .rejects.toThrow('CORE_MANAGER_LOCK_RELEASE_UNVERIFIED');
    expect(released).toEqual([true]);
  });

  it('rejects malformed lock acquisition without any manager side effects', async () => {
    const { pool, released } = poolFake({ acquire: null });
    let ran = false;
    await expect(withCoreManagerPgLock(pool, async () => { ran = true; }))
      .rejects.toThrow('CORE_MANAGER_LOCK_CLAIM_UNVERIFIED');
    expect(ran).toBe(false);
    expect(released).toEqual([false]);
  });

  it('is wired around the real managerTick Core decision and materialization path', () => {
    const source = readFileSync(new URL('../apps/tigeriq-core/core.mjs', import.meta.url), 'utf8');
    const managerStart = source.indexOf('async function managerTick() {');
    const managerEnd = source.indexOf('\nfunction publicStatus(', managerStart);
    expect(managerStart).toBeGreaterThan(0);
    expect(managerEnd).toBeGreaterThan(managerStart);
    const manager = source.slice(managerStart, managerEnd);
    expect(manager).toContain('return withCoreManagerPgLock(pool, async () => {');
    expect(manager).toContain('CAMPAIGN_PHASE_COMPLETED');
    expect(manager).toContain('JOB_CREATED');
    expect(manager.trimEnd().replace(/\r/g, '').endsWith('});\n}')).toBe(true);
    expect(manager).not.toContain('pg_advisory_unlock');
  });
});
