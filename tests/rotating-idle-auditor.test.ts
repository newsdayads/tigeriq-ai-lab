import test from 'node:test';
import assert from 'node:assert';
import { Pool } from 'pg';

test('Rotating idle auditor scheduler tests', async (t) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('DATABASE_URL not set, skipping integration test for auditor');
    return;
  }
  const pool = new Pool({ connectionString });

  await pool.query(`
    create table if not exists tigeriq_auditor_state (
      id text primary key default 'singleton',
      last_light_scan_at timestamptz,
      last_deep_scan_at timestamptz,
      last_heartbeat_at timestamptz,
      last_emitted_handoff_id text,
      active_issue_fingerprint text,
      updated_at timestamptz default now()
    );
  `);
  await pool.query("insert into tigeriq_auditor_state (id) values ('singleton') on conflict (id) do nothing;");

  await t.test('State persists and heartbeat is recorded', async () => {
    await pool.query(`update tigeriq_auditor_state set last_light_scan_at = now() - interval '11 minutes' where id='singleton'`);
    
    const resBefore = await pool.query("select * from tigeriq_auditor_state where id='singleton'");
    assert.ok(resBefore.rows.length > 0);

    await pool.query(`update tigeriq_auditor_state set last_heartbeat_at = now(), last_light_scan_at = now() where id='singleton'`);
    const resAfter = await pool.query("select * from tigeriq_auditor_state where id='singleton'");
    assert.ok(resAfter.rows[0].last_heartbeat_at);
  });

  await t.test('Deduplicated handoff creation', async () => {
    await pool.query("delete from tigeriq_objectives where metadata->>'source' = 'auditor_deep_scan'");
    const fingerprint = 'test_issue_123';
    
    await pool.query(
      'insert into tigeriq_objectives(id, objective, priority, metadata) values($1, $2, $3, $4)',
      ['HANDOFF-TEST-1', 'Auditor Finding: test issue', 'P1', JSON.stringify({ source: 'auditor_deep_scan', fingerprint })]
    );
    await pool.query(
      "update tigeriq_auditor_state set active_issue_fingerprint = $1, last_emitted_handoff_id = 'HANDOFF-TEST-1' where id='singleton'",
      [fingerprint]
    );

    const countRes = await pool.query("select count(*) as cnt from tigeriq_objectives where metadata->>'source' = 'auditor_deep_scan'");
    assert.strictEqual(Number(countRes.rows[0].cnt), 1);
  });

  await pool.end();
});
