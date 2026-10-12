// One Core manager tick across all OS processes sharing the same PostgreSQL.
// Keep the session lock for the entire decision + materialization pass.
// Any process exit releases the session lock automatically in PostgreSQL.
export const CORE_MANAGER_PG_LOCK_KEY = 'TIGERIQ_CORE_MANAGER_TICK_V1';

export async function withCoreManagerPgLock(pool, run) {
  if (!pool || typeof pool.connect !== 'function' || typeof run !== 'function') {
    throw new Error('CORE_MANAGER_LOCK_INPUT_INVALID');
  }
  const client = await pool.connect();
  let held = false;
  let destroy = false;
  try {
    const claim = await client.query(
      'select pg_try_advisory_lock(hashtext($1)) as acquired',
      [CORE_MANAGER_PG_LOCK_KEY],
    );
    if (claim.rows?.[0]?.acquired === false) return { admitted: false };
    if (claim.rows?.[0]?.acquired !== true) throw new Error('CORE_MANAGER_LOCK_CLAIM_UNVERIFIED');
    held = true;
    return { admitted: true, outcome: await run() };
  } finally {
    if (held) {
      try {
        const release = await client.query(
          'select pg_advisory_unlock(hashtext($1)) as unlocked',
          [CORE_MANAGER_PG_LOCK_KEY],
        );
        if (release.rows?.[0]?.unlocked !== true) throw new Error('CORE_MANAGER_LOCK_RELEASE_UNVERIFIED');
      } catch (error) {
        destroy = true;
        client.release(true);
        throw error;
      }
    }
    if (!destroy) client.release();
  }
}
