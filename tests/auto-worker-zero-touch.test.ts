import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifestPath = 'artifacts/auto-worker/zero-touch/v1/manifest.v14.2.2.json';
const updaterPath = 'scripts/pc-worker/auto-worker-zero-touch-updater.ps1';
const statusPath = 'scripts/pc-worker/autoworker-deploy-status.ps1';
const expectedManifestSha = 'd3e8f3840209924038980fd595600db97a718be9bed20ff39bf7e10b5b4b1fca';

describe('Auto Worker zero-touch updater', () => {
  it('pins the candidate manifest by SHA-256 and immutable source commit', () => {
    const raw = readFileSync(manifestPath);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(expectedManifestSha);
    const manifest = JSON.parse(raw.toString('utf8'));
    expect(manifest.repo).toBe('newsdayads/tigeriq-ai-lab');
    expect(manifest.source_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.extension_id).toBe('leidfhbpdillakmcbijagelghhilbnpc');
    expect(manifest.target_version).toBe('14.2.2');
    expect(manifest.health.active_background_employee_ids).toEqual(['NV02']);
    expect(manifest.health.inactive_background_employee_ids).toEqual(['NV04', 'NV05']);
    for (const p of manifest.payloads) {
      expect(p.source_path).not.toContain('..');
      expect(p.git_blob_sha1).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('implements stage -> verify -> same-volume swap -> health -> rollback', () => {
    const src = readFileSync(updaterPath, 'utf8');
    expect(src).toContain('ExpectedManifestSha256');
    expect(src).toContain('MANIFEST_SHA256_MISMATCH');
    expect(src).toContain('Get-GitBlobSha1');
    expect(src).toContain('PAYLOAD_PROVENANCE_MISMATCH');
    expect(src).toContain('.tiq_stage.');
    expect(src).toContain('.tiq_backup.');
    expect(src).toContain('Move-Item -LiteralPath $script:ExtensionPath -Destination $script:BackupPath');
    expect(src).toContain('Assert-Health $script:StagePath');
    expect(src).toContain('Assert-Health $script:ExtensionPath');
    expect(src).toContain('Restore-Backup');
    expect(src).toContain('EXTENSION_KEY_CHANGED_IN_STAGE');
  });

  it('never taskkills/uninstalls Chrome and only reloads when Chrome was already running', () => {
    const src = readFileSync(updaterPath, 'utf8');
    expect(src).not.toMatch(/taskkill/i);
    expect(src).not.toMatch(/Stop-Process/i);
    expect(src).not.toMatch(/uninstall/i);
    expect(src).toContain("if(-not$script:ChromeWasRunning){return @{Ok=$true;Mode='CHROME_NOT_RUNNING_ON_DISK_ONLY'}}");
    expect(src).toContain('chrome://extensions/?id=');
  });

  it('persists only a fixed sanitized deploy-status record for the typed read-only action', () => {
    const updater = readFileSync(updaterPath, 'utf8');
    const status = readFileSync(statusPath, 'utf8');
    expect(updater).toContain('zero-touch-status.json');
    expect(status).toContain('zero-touch-status.json');
    expect(status).not.toMatch(/Invoke-Expression|iex\b|cmd\.exe|powershell\.exe/i);
    expect(status).not.toMatch(/Get-ChildItem|Get-CimInstance|Invoke-WebRequest/i);
    for (const key of ['phase','version','extension_id','source_commit','manifest_sha256','chrome_running','reload_mode','rolled_back','updated_at']) {
      expect(status).toContain(key);
    }
  });
});
