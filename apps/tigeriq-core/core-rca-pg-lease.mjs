// Serialize Auto-RCA GitHub create/rearm across Core processes on the same PostgreSQL.
// A session advisory lock survives async work, and PostgreSQL releases it if the Core dies.
export const CORE_RCA_PG_LOCK_KEY = 'TIGERIQ_CORE_AUTO_RCA_MATERIALIZE_V1';

export async function withCoreRcaPgLease(pool, run) {
  if (!pool || typeof pool.connect !== 'function' || typeof run !== 'function')
    throw new Error('RCA_PG_LOCK_INPUT_INVALID');
  const client = await pool.connect();
  let held = false;
  let discarded = false;
  try {
    const claimed = await client.query(
      'select pg_try_advisory_lock(hashtext($1)) as acquired',
      [CORE_RCA_PG_LOCK_KEY],
    );
    if (claimed.rows?.[0]?.acquired === false) return { admitted: false };
    if (claimed.rows?.[0]?.acquired !== true) throw new Error('RCA_PG_LOCK_CLAIM_UNVERIFIED');
    held = true;
    return { admitted: true, outcome: await run() };
  } finally {
    if (held) {
      try {
        const release = await client.query(
          'select pg_advisory_unlock(hashtext($1)) as unlocked',
          [CORE_RCA_PG_LOCK_KEY],
        );
        if (release.rows?.[0]?.unlocked !== true) throw new Error('RCA_PG_LOCK_RELEASE_UNVERIFIED');
      } catch (error) {
        discarded = true;
        client.release(true);
        throw error;
      }
    }
    if (!discarded) client.release();
  }
}
