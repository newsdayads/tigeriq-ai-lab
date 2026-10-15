import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-ignore JS source is an untyped standalone local CLI helper.
import { inspectB01Json } from '../../projects/dexcam-personal/b01-local-preflight.mjs';

const script = resolve('projects/dexcam-personal/b01-local-preflight.mjs');
const fixture = () => ({
  schema: 'dexcam-b01-v1',
  capture_kind: 'SYNTHETIC_FIXTURE',
  observed_at: new Date(Date.now() - 60_000).toISOString(),
  android: {
    manufacturer: 'Samsung', model: 'SM-TEST', android_version: '16',
    api_level: 36, one_ui_version: '8.0'
  },
  dex: { mode: 'EXTERNAL_DISPLAY', source: 'LOCAL_ONLY:dex-screenshot-01' },
  display: {
    display_id: 1, logical_width_px: 1920, logical_height_px: 1080,
    density_dpi: 240, smallest_width_dp: 800, rotation_deg: 0,
    source: 'LOCAL_ONLY:display-readback-01'
  },
  evidence: {
    android_settings: 'LOCAL_ONLY:settings-01',
    dex_observation: 'LOCAL_ONLY:dex-01',
    display_readback: 'LOCAL_ONLY:display-01'
  },
  redaction_confirmed: true
});

function runFile(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), 'dexcam-b01-preflight-'));
  const file = join(dir, 'local-private.json');
  try {
    writeFileSync(file, contents);
    const processResult = spawnSync(process.execPath, [script, file], {
      encoding: 'utf8', timeout: 8000
    });
    return {
      exit: processResult.status,
      output: JSON.parse(processResult.stdout),
      stdout: processResult.stdout,
      stderr: processResult.stderr
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it('local CLI executes a structurally valid synthetic file without pretending B01 acceptance', () => {
  const r = runFile(JSON.stringify(fixture()));
  expect(r.exit).toBe(0);
  expect(r.output.status).toBe('SYNTHETIC_FIXTURE_ONLY');
  expect(r.output.b01_accepted).toBe(false);
  expect(r.output.errors).toEqual([]);
  expect(r.stderr).toBe('');
});

it('real-shaped record is only a candidate requiring physical evidence review', () => {
  const data = fixture();
  data.capture_kind = 'REAL_DEVICE_OBSERVATION';
  data.android.model = 'SM-X999';
  const r = runFile(JSON.stringify(data));
  expect(r.exit).toBe(0);
  expect(r.output.status).toBe('CANDIDATE_NEEDS_DEVICE_REVIEW');
  expect(r.output.b01_accepted).toBe(false);
});

it('CLI rejects malformed JSON without leaking input', () => {
  const secret = '{"private_IMEI_123": "VERY_SECRET_DEVICE_VALUE"';
  const r = runFile(secret);
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('input:INVALID_JSON');
  expect(r.stdout).not.toContain('VERY_SECRET_DEVICE_VALUE');
  expect(r.stderr).not.toContain('VERY_SECRET_DEVICE_VALUE');
});

it('validator unexpected private keys are scrubbed from CLI errors', () => {
  const data = fixture() as any;
  data['SECRET_SERIAL_IDENTIFIER_123'] = 'THIS_MUST_NOT_LEAK';
  const r = runFile(JSON.stringify(data));
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('input:UNEXPECTED_OR_PRIVATE_FIELD');
  expect(r.stdout).not.toContain('SECRET_SERIAL_IDENTIFIER_123');
  expect(r.stdout).not.toContain('THIS_MUST_NOT_LEAK');
});

it('CLI detects duplicate B01 local evidence reference and does not accept', () => {
  const data = fixture();
  data.evidence.dex_observation = data.evidence.android_settings;
  const r = runFile(JSON.stringify(data));
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('evidence.dex_observation:DUPLICATE_EVIDENCE_POINTER');
  expect(r.output.b01_accepted).toBe(false);
});

it('CLI refuses files larger than 64 KiB without dumping bytes', () => {
  const r = runFile('SENSITIVE_BYTES_' + 'x'.repeat(70_000));
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('input:FILE_TOO_LARGE');
  expect(r.stdout).not.toContain('SENSITIVE_BYTES_');
});

it('CLI refuses a missing argument and does not list a private path', () => {
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 8000 });
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout).errors).toContain('input:ONE_LOCAL_JSON_PATH_REQUIRED');
});

it('CLI does not echo nonexistent paths or filesystem errors', () => {
  const missing = join(tmpdir(), 'NEVER_PRINT_THIS_PRIVATE_PATH_987654321.json');
  const r = spawnSync(process.execPath, [script, missing], { encoding: 'utf8', timeout: 8000 });
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).errors).toContain('input:READ_FAILED');
  expect(r.stdout).not.toContain('NEVER_PRINT_THIS_PRIVATE_PATH_987654321');
  expect(r.stderr).toBe('');
});

it('imported preflight helper safely rejects non-JSON data without filesystem reads', () => {
  expect(inspectB01Json('{bad').errors).toContain('input:INVALID_JSON');
});
