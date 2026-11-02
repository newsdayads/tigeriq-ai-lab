// GH-5135 F10: verified V1 bottom Camera action source contract.
// Static source coverage is not physical USB/DeX acceptance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F10 bottom Camera action source contract', () => {
  it('keeps the verified V1 three-action bottom order and restores Camera', () => {
    const saved = home.indexOf('button("▣\\nCấu hình đã lưu"');
    const create = home.indexOf('button("+\\nLưu cấu hình"', saved);
    const ultrabot = home.indexOf('renderUltrabot(.675f, .887f, .278f, .062f)', create);
    const camera = home.indexOf('button(\n            "CAMERA"', ultrabot);
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(saved);
    expect(ultrabot).toBeGreaterThan(create);
    expect(camera).toBeGreaterThan(ultrabot);
  });

  it('uses Ultrabot only as decorative media behind an explicit transparent Camera action', () => {
    const renderStart = home.indexOf('private fun render()');
    const renderEnd = home.indexOf('// Real, device-local HOME snapshots only', renderStart);
    const block = home.slice(renderStart, renderEnd);
    expect(block).toContain('renderUltrabot(.675f, .887f, .278f, .062f)');
    expect(block).toContain('"CAMERA"');
    expect(block).toContain('outline = false');
    expect(block).toContain('transparent = true');
    expect(block).toContain('startActivity(Intent(this, UsbCameraActivity::class.java))');
  });

  it('does not make the Ultrabot renderer itself own Camera semantics', () => {
    const start = home.indexOf('private fun renderUltrabot(');
    const end = home.indexOf('private fun label(', start);
    const block = home.slice(start, end);
    expect(block).toContain('bot.isClickable = false');
    expect(block).not.toContain('UsbCameraActivity');
  });
});
