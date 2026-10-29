import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overlay = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/OverlayService.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F07 DeX overlay persistence source contract', () => {
  it('stores camera shortcut position per display and migrates legacy x/y', () => {
    expect(overlay).toContain('OverlayPositionRules.xKey(id)');
    expect(overlay).toContain('OverlayPositionRules.yKey(id)');
    expect(overlay).toContain('storedInt("x")');
    expect(overlay).toContain('storedInt("y")');
    expect(overlay).toContain('OverlayPositionRules.restoredCoordinate(');
    expect(overlay).toContain('.putInt(xKey, p.x)');
    expect(overlay).toContain('.putInt(yKey, p.y)');
    expect(overlay).toContain('.remove("x")');
    expect(overlay).toContain('.remove("y")');
  });

  it('re-attaches the current overlay when display geometry changes', () => {
    expect(overlay).toContain('private fun update(forceReattach: Boolean = false)');
    expect(overlay).toContain('if (!forceReattach && shortcut != null && currentId == id) return');
    expect(overlay).toContain('update(forceReattach = displayId == currentId)');
  });

  it('supports explicit force re-attach so restored positions apply immediately', () => {
    expect(overlay).toContain('const val EXTRA_FORCE_REATTACH');
    expect(overlay).toContain('getBooleanExtra(EXTRA_FORCE_REATTACH, false)');
    expect(overlay).toContain('update(forceReattach = forceReattach)');
  });

  it('clamps restored positions against the active display bounds', () => {
    expect(overlay).toContain('OverlayPositionRules.clamp(');
    expect(overlay).toContain('display.mode.physicalWidth');
    expect(overlay).toContain('display.mode.physicalHeight');
    expect(overlay).toContain('p.x = restored.x');
    expect(overlay).toContain('p.y = restored.y');
  });
});
