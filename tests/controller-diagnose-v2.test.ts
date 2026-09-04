import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/pc-worker/repair-control-plane-controller-diagnose.ps1', 'utf8');

describe('Workforce Controller diagnostic V4 repair contract', () => {
  it('upgrades V1/V2/V3 in place with backup, compile verification and rollback', () => {
    expect(source).toContain("$markerV1='# TIGERIQ_CONTROLLER_DIAGNOSE_V1'");
    expect(source).toContain("$markerV2='# TIGERIQ_CONTROLLER_DIAGNOSE_V2'");
    expect(source).toContain("$markerV3='# TIGERIQ_CONTROLLER_DIAGNOSE_V3'");
    expect(source).toContain("$markerV4='# TIGERIQ_CONTROLLER_DIAGNOSE_V4'");
    expect(source).toContain("$text.IndexOf('def workforce_diagnose():')");
    expect(source).toContain("$text.IndexOf('def workforce_build():',$start)");
    expect(source).toContain('Copy-Item -LiteralPath $control -Destination $backup -Force');
    expect(source).toContain('& $python -m py_compile $tmp');
    expect(source).toContain('ROLLBACK_OK');
  });

  it('returns bounded updater, self-heal and Controller contract metadata without raw secrets/errors', () => {
    expect(source).toContain("'diagnostic_version': 4");
    expect(source).toContain("'database_url_readable_by_worker'");
    expect(source).toContain("'pgpass_readable_by_worker'");
    expect(source).toContain("'ingress_token_file_exists'");
    expect(source).toContain("'ingress_token_readable_by_worker'");
    expect(source).toContain("'worker_env_ingress_token_present'");
    expect(source).toContain("'sets_ingress_token'");
    expect(source).toContain("'run_as_system'");
    expect(source).toContain("'task_uses_expected_runner'");
    expect(source).toContain("'scheduled_log_writable_by_worker'");
    expect(source).toContain("'runner': runner_meta()");
    expect(source).toContain("'task': task_meta()");
    expect(source).toContain("'self_heal': self_heal_meta()");
    expect(source).toContain("'updater': updater_meta()");
    expect(source).toContain("'current_release': current_release_meta()");
    expect(source).toContain("'status_contract': status_contract_meta()");
    expect(source).toContain("'installed_sha'");
    expect(source).toContain("'error_code'");
    expect(source).toContain("'error_sha256'");
    expect(source).toContain("'/api/workforce/status'");
    expect(source).not.toContain('db_url_file.read_text');
    expect(source).not.toContain('pgpass_file.read_text');
    expect(source).not.toContain('ingress_token_file.read_text');
    expect(source).not.toContain("'error': error");
  });

  it('derives error_code only from the fixed classifier allowlist', () => {
    expect(source).not.toContain("text.split(':', 1)[0]");
    expect(source).toContain("classification = classify_text(text)");
    expect(source).toContain("code = classification if classification != 'UNCLASSIFIED' else None");
    expect(source).toContain("return {'error_class': classification, 'error_code': code, 'error_sha256': digest}");
  });

  it('does not widen network, rotate credentials or redefine the Controller task', () => {
    expect(source).not.toContain('New-NetFirewallRule');
    expect(source).not.toContain('Set-NetFirewallRule');
    expect(source).not.toContain('Register-ScheduledTask -TaskName \'TigerIQ Workforce Controller\'');
    expect(source).not.toContain('Unregister-ScheduledTask -TaskName \'TigerIQ Workforce Controller\'');
    expect(source).not.toContain('Set-Content F:\\TigerIQ\\Secrets');
  });
});
