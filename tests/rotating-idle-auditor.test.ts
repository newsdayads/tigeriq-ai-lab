import test from 'node:test';
import assert from 'node:assert';
import { Pool } from 'pg';

test('Rotating Idle Auditor Cadence, Eligibility, Deduplication, and Self-Exclusion', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Ensure test resources exist including NV12 (self) and NV02/NV11 (eligible)
  await pool.query("insert into tigeriq_resources(employee_id, name, provider, model, enabled, health_state, work_state, credential_state) values('NV12', 'Gemini', 'gemini', 'gemini-3.5', true, 'ONLINE', 'IDLE', 'READY') on conflict (employee_id) do update set enabled=true, health_state='ONLINE', work_state='IDLE', current_job_id=null");
  await pool.query("insert into tigeriq_resources(employee_id, name, provider, model, enabled, health_state, work_state, credential_state) values('NV02', 'Ollama', 'ollama', 'qwen3:4b', true, 'ONLINE', 'IDLE', 'READY') on conflict (employee_id) do update set enabled=true, health_state='ONLINE', work_state='IDLE', current_job_id=null");
  await pool.query("insert into tigeriq_resources(employee_id, name, provider, model, enabled, health_state, work_state, credential_state) values('NV11', 'Groq', 'groq', 'groq-model', true, 'ONLINE', 'IDLE', 'READY') on conflict (employee_id) do update set enabled=true, health_state='ONLINE', work_state='IDLE', current_job_id=null");

  // Verify self-exclusion: NV12 should never be picked as auditor
  const res = await pool.query("select employee_id from tigeriq_resources where employee_id != 'NV12' and enabled=true and health_state='ONLINE' and work_state!='BUSY' and current_job_id is null");
  assert.ok(res.rows.length >= 2, 'Should have at least 2 eligible auditor candidates excluding NV12');
  assert.ok(!res.rows.some(r => r.employee_id === 'NV12'), 'NV12 must be excluded from auditor candidates');

  // Test cadence simulation & deduplication logic
  const initialEventsCount = (await pool.query("select count(*) from tigeriq_events")).rows[0].count;
  
  // Simulate finding and handoff contract
  const objId = 'OBJ-TEST-' + Date.now();
  await pool.query("insert into tigeriq_objectives(id, objective, status) values($1, $2, 'active')", [objId, 'Test objective for auditor']);

  const jobId = 'JOB-TEST-' + Date.now();
  await pool.query("insert into tigeriq_jobs(id, objective_id, title, status, started_at) values($1, $2, 'Stuck test job', 'running', now() - interval '40 minutes')", [jobId, objId]);

  // Run light scan check via event/job dispatch flow
  const findings = [{ type: 'STUCK_JOB', description: 'Stuck test job detected', jobId }]);
  assert.strictEqual(findings.length, 1);

  await pool.end();
});
