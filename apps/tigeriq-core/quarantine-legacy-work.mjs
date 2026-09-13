// Preserve exact old rows before blocking legacy execution. No deletion or automatic replay.
const tables = [
  ['tigeriq_coding_objectives', ['active','blocked']],
  ['tigeriq_coding_jobs', ['queued','running','review','waiting_ci','waiting_resource','failed','blocked']],
  ['tigeriq_objectives', ['active','blocked']],
  ['tigeriq_jobs', ['queued','running','failed','blocked']]
];
export async function quarantineLegacyWork(pool) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(734001)");
    await client.query(`create table if not exists tigeriq_legacy_quarantine(
      source_table text not null, source_id text not null, original_row jsonb not null,
      quarantined_at timestamptz not null default now(),
      primary key(source_table,source_id))`);
    for (const [table,statuses] of tables) {
      const exists = await client.query('select to_regclass($1) as name',[table]);
      if (!exists.rows[0]?.name) continue;
      // Table names are fixed above, never supplied by an external caller.
      await client.query(`insert into tigeriq_legacy_quarantine(source_table,source_id,original_row)
        select $1,id,to_jsonb(t) from ${table} t where status=any($2::text[])
        on conflict(source_table,source_id) do nothing`,[table,statuses]);
      await client.query(`update ${table} set status='blocked' where status=any($1::text[])`,[statuses]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}
