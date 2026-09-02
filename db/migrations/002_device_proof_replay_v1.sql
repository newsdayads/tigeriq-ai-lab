BEGIN;

CREATE TABLE IF NOT EXISTS device_proof_replay_state (
  device_id text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  nonce text NOT NULL,
  proof_timestamp timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (device_id, nonce),
  CHECK (length(nonce) BETWEEN 16 AND 128),
  CHECK (expires_at > accepted_at)
);

CREATE INDEX IF NOT EXISTS ix_device_proof_replay_expiry
  ON device_proof_replay_state(expires_at);

INSERT INTO tigeriq_schema_migrations(version)
VALUES('002_device_proof_replay_v1')
ON CONFLICT(version) DO NOTHING;

COMMIT;
