import test from 'node:test';
import assert from 'node:assert';
import { Pool } from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { recoverOrphanedJobs } from '../apps/coding-lane/coding-lane.mjs';

test('coding lane orphan recovery handles merged PRs, resumable jobs, and is idempotent', async () => {
  const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/tigeriq_test';
  const pool = new Pool({ connectionString });

  try {
    await pool.query('select 1');
  } catch (e) {
    console.warn('Skipping coding-lane-orphan-recovery test: database not available');
    return;
  }

  // Setup test schema
  await pool.query(`
    create table if not exists tigeriq_coding_objectives (
      id text primary key,
      objective text not null,
      status text default 'active',
      priority text default 'P1',
      summary text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    create table if not exists tigeriq_coding_jobs (
      id text primary key,
      objective_id text references tigeriq_coding_objectives(id),
      status text not null,
      paths jsonb,
      result jsonb,
      pr_number int,
      head_sha text,
      completed_at timestamptz,
      created_at timestamptz default now()
    );
  `);

  // Clean tables
  await pool.query('delete from tigeriq_coding_jobs');
  await pool.query('delete from tigeriq_coding_objectives');

  // Insert test objectives and jobs
  await pool.query(`insert into tigeriq_coding_objectives(id, objective, status) values ('OBJ-1', 'Test objective 1', 'active')`);
  await pool.query(`insert into tigeriq_coding_objectives(id, objective, status) values ('OBJ-2', 'Test objective 2', 'active')`);

  // Job 1: stale running job with a merged PR
  await pool.query(`
    insert into tigeriq_coding_jobs(id, objective_id, status, result, pr_number)
    values ('JOB-1', 'OBJ-1', 'running', $1, 101)
  `, [JSON.stringify({ prNumber: 101 })]);

  // Job 2: unfinished stale job
  await pool.query(`
    insert into tigeriq_coding_jobs(id, objective_id, status, pr_number)
    values ('JOB-2', 'OBJ-2', 'waiting_ci', 102)
  `);

  // Mock global gh function or fetch if used by coding-lane
  // Since coding-lane uses global gh or fetch, let's attach global gh mock
  global.gh = async (endpoint) => {
    if (endpoint === '/pulls/101') {
      return { number: 101, state: 'closed', merged: true, merge_commit_sha: 'abc123sha' };
    }
    if (endpoint === '/pulls/102') {
      return { number: 102, state: 'open', merged: false };
    }
    throw new Error('Not found');
  };

  // Attach pool to coding lane module if needed, or set global pool
  // Wait, coding-lane imports pool. Let's make sure pool is imported correctly or exported.
  // Since coding-lane defines `const pool = new Pool(...)` internally, let's inject via monkeypatch or test environment if exported, or verify db state.

  // First recovery run
  const actions1 = await recoverOrphanedJobs();
  assert.ok(Array.isArray(actions1));
  
  const j1 = (await pool.query("select * from tigeriq_coding_jobs where id='JOB-1'")).rows[0];
  const j2 = (await pool.query("select * from tigeriq_coding_jobs where id='JOB-2'")).rows[0];

  assert.strictEqual(j1.status, 'done');
  assert.strictEqual(j2.status, 'running');

  // Verify evidence file generated
  const evidencePath = path.resolve(process.cwd(), 'reports', 'coding-lane-recovery-evidence.json');
  const evidenceRaw = await fs.readFile(evidencePath, 'utf8');
  const evidence = JSON.parse(evidenceRaw);
  assert.ok(evidence.actions.length >= 2);

  // Second run to verify idempotence
  const actions2 = await recoverOrphanedJobs();
  const j1_second = (await pool.query("select * from tigeriq_coding_jobs where id='JOB-1'")).rows[0];
  const j2_second = (await pool.query("select * from tigeriq_coding_jobs where id='JOB-2'")).rows[0];

  assert.strictEqual(j1_second.status, 'done');
  assert.strictEqual(j2_second.status, 'running');

  await pool.end();
});
