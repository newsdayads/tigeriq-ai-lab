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
    await client.query(`create table if not exists tigeriq_migrations(
      id text primary key, applied_at timestamptz not null default now())`);
    const applied = await client.query("select id from tigeriq_migrations where id='step1-legacy-quarantine'");
    if (applied.rowCount) { await client.query('commit'); return; }
    for (const [table,statuses] of tables) {
      const exists = await client.query('select to_regclass($1) as name',[table]);
      if (!exists.rows[0]?.name) continue;
      // Table names are fixed above, never supplied by an external caller.
      await client.query(`insert into tigeriq_legacy_quarantine(source_table,source_id,original_row)
        select $1,id,to_jsonb(t) from ${table} t where status=any($2::text[])
        on conflict(source_table,source_id) do nothing`,[table,statuses]);
      await client.query(`update ${table} set status='blocked' where status=any($1::text[])`,[statuses]);
    }
    // Release only leases belonging to the snapshotted legacy cohort, preserving their original rows.
    await client.query(`insert into tigeriq_legacy_quarantine(source_table,source_id,original_row)
      select 'tigeriq_resources',employee_id,to_jsonb(r) from tigeriq_resources r
      where current_job_id in (select source_id from tigeriq_legacy_quarantine where source_table='tigeriq_jobs')
      on conflict(source_table,source_id) do nothing`);
    await client.query(`update tigeriq_resources set current_job_id=null,work_state='IDLE'
      where current_job_id in (select source_id from tigeriq_legacy_quarantine where source_table='tigeriq_jobs')`);
    await client.query("insert into tigeriq_migrations(id) values('step1-legacy-quarantine')");
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}
