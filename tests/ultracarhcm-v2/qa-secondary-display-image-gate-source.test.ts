import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const spec = readFileSync(new URL('./QA_SECONDARY_DISPLAY_SCREEN_GUARD_20261117.md', import.meta.url), 'utf8');
const harness = readFileSync(new URL('./qa-secondary-display-image-gate.ps1', import.meta.url), 'utf8');

describe('GH-5135 screenshot gate: no false GREEN for a blank Android external display', () => {
  it('pins the real, previously reproduced blank image and visual acceptance thresholds', () => {
    expect(spec).toContain('1** sampled color');
    expect(spec).toContain('894** sampled colors');
    expect(harness).toContain('[ValidateSet("ImageOnly", "VirtualDevice")]');
    expect(harness).toContain('[int]$MinDistinctColors = 96');
    expect(harness).toContain('[double]$MinLuminanceStdDev = 12');
    expect(harness).toContain('distinctColors -ge $MinDistinctColors');
    expect(harness).toContain('stdDev -ge $MinLuminanceStdDev');
  });
  it('allows ONLY isolated QA and verifies task placement on target display', () => {
    expect(harness).toContain('ai.tigeriq.ultracarhcm.v2.vqa');
    expect(harness).toContain('VirtualDevice only accepts isolated V2 QA');
    expect(harness).toContain('am force-stop');
    expect(harness).toContain('am start -W --display');
    expect(harness).toContain('mResumedActivity');
    expect(harness).toContain('screencap -p -d');
    expect(harness).not.toContain('install -r');
  });
  it('always restores the display setting and rejects unexpected existing configuration', () => {
    expect(harness).toContain('settings get global overlay_display_devices');
    expect(harness).toContain('settings delete global overlay_display_devices');
    expect(harness).toContain('finally {');
    expect(harness).toContain('if ($originalSetting -ne "null")');
    expect(harness).toContain('if (-not $restored)');
    expect(harness).toContain('exit 2');
  });
});
