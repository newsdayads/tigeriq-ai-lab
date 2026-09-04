import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/pc-worker/repair-control-plane-controller-diagnose.ps1', 'utf8');

describe('Workforce Controller diagnostic V2 repair contract', () => {
  it('upgrades V1 in place with backup, compile verification and rollback', () => {
    expect(source).toContain("$markerV1='# TIGERIQ_CONTROLLER_DIAGNOSE_V1'");
    expect(source).toContain("$markerV2='# TIGERIQ_CONTROLLER_DIAGNOSE_V2'");
    expect(source).toContain("$text.IndexOf('def workforce_diagnose():')");
    expect(source).toContain("$text.IndexOf('def workforce_build():',$start)");
    expect(source).toContain('Copy-Item -LiteralPath $control -Destination $backup -Force');
    expect(source).toContain('& $python -m py_compile $tmp');
    expect(source).toContain('ROLLBACK_OK');
  });

  it('returns only bounded metadata for runner, task, self-heal and file access', () => {
    expect(source).toContain("'diagnostic_version': 2");
    expect(source).toContain("'database_url_readable_by_worker'");
    expect(source).toContain("'pgpass_readable_by_worker'");
    expect(source).toContain("'scheduled_log_writable_by_worker'");
    expect(source).toContain("'runner': runner_meta()");
    expect(source).toContain("'task': task_meta()");
    expect(source).toContain("'self_heal': self_heal_meta()");
    expect(source).not.toContain('db_url_file.read_text');
    expect(source).not.toContain('pgpass_file.read_text');
  });

  it('does not widen network, rotate credentials or redefine the Controller task', () => {
    expect(source).not.toContain('New-NetFirewallRule');
    expect(source).not.toContain('Set-NetFirewallRule');
    expect(source).not.toContain('Register-ScheduledTask -TaskName \'TigerIQ Workforce Controller\'');
    expect(source).not.toContain('Unregister-ScheduledTask -TaskName \'TigerIQ Workforce Controller\'');
  });
});
