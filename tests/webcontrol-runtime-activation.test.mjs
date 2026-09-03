import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/pc-worker/activate-webcontrol-runtime.ps1', 'utf8');

describe('WebControl runtime activation', () => {
  it('requires exact SHA CI PASS and three distinct immutable local model digests', () => {
    expect(source).toContain("$head -ne $Commit");
    expect(source).toContain("$_.name -eq 'CI' -and $_.conclusion -eq 'success'");
    expect(source).toContain("[string]$ThirdModel = 'gemma3:4b'");
    expect(source).toContain("THREE_MODEL_DIGEST_GATE_NOT_MET");
    expect(source).toContain("$digests.Count -lt 3");
  });

  it('deploys Workforce Controller into an isolated release and preserves state/secrets', () => {
    expect(source).toContain("F:\\TigerIQ\\WorkforceController");
    expect(source).toContain("F:\\TigerIQ\\State\\workforce.jsonl");
    expect(source).toContain("F:\\TigerIQ\\Secrets\\workforce-admin.secret");
    expect(source).toContain("git clone --no-checkout");
    expect(source).toContain("checkout --detach $Commit");
    expect(source).not.toContain('reset --hard');
    expect(source).not.toContain('git clean');
  });

  it('keeps controller private and fails closed on an unknown port owner', () => {
    expect(source).toContain("100.64.0.0/10");
    expect(source).toContain("CONTROLLER_PORT_OWNED_BY_UNKNOWN_PROCESS");
    expect(source).toContain("/api/workforce/status");
    expect(source).toContain("WEBCONTROL_CONTROLLER_NOT_ONLINE");
    expect(source).toContain("mainProductionTouched=$false");
  });
});
