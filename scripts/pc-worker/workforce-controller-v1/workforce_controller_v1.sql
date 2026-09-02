BEGIN;

CREATE TABLE IF NOT EXISTS workforce_employee (
  employee_id text PRIMARY KEY,
  display_name text NOT NULL,
  department text NOT NULL,
  role text NOT NULL,
  provider text,
  model text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','busy','offline','degraded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workforce_device (
  device_id text PRIMARY KEY,
  kind text NOT NULL,
  platform text NOT NULL,
  agent_version text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  token_sha256 char(64) NOT NULL,
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online','degraded','offline')),
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workforce_job (
  job_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  employee_id text NOT NULL REFERENCES workforce_employee(employee_id),
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','completed','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS workforce_job_queue_idx ON workforce_job(status, employee_id, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS workforce_prompt (
  prompt_id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES workforce_job(job_id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence BETWEEN 0 AND 10000),
  role text NOT NULL,
  content_sha256 char(64) NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, sequence)
);

CREATE TABLE IF NOT EXISTS workforce_lease (
  lease_id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES workforce_job(job_id),
  device_id text NOT NULL REFERENCES workforce_device(device_id),
  employee_id text NOT NULL REFERENCES workforce_employee(employee_id),
  lease_token_sha256 char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS workforce_active_job_lease_idx ON workforce_lease(job_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS workforce_lease_expiry_idx ON workforce_lease(status, expires_at);

CREATE TABLE IF NOT EXISTS workforce_heartbeat (
  heartbeat_id bigserial PRIMARY KEY,
  device_id text NOT NULL REFERENCES workforce_device(device_id) ON DELETE CASCADE,
  status text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_heartbeat_device_idx ON workforce_heartbeat(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workforce_result (
  result_id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE REFERENCES workforce_job(job_id),
  lease_id text NOT NULL REFERENCES workforce_lease(lease_id),
  device_id text NOT NULL REFERENCES workforce_device(device_id),
  employee_id text NOT NULL REFERENCES workforce_employee(employee_id),
  provider text,
  model text,
  output jsonb NOT NULL,
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 10),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  timestamps jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workforce_evidence (
  evidence_id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES workforce_job(job_id) ON DELETE CASCADE,
  lease_id text NOT NULL REFERENCES workforce_lease(lease_id),
  device_id text NOT NULL REFERENCES workforce_device(device_id),
  kind text NOT NULL,
  uri text,
  sha256 char(64) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_evidence_job_idx ON workforce_evidence(job_id, created_at ASC);

COMMIT;
