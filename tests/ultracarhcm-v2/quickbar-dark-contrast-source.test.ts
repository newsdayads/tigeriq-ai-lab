import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/QuickBarCompose.kt', import.meta.url), 'utf8');
const spec = readFileSync(new URL('./F10_QUICKBAR_VISUAL_SPEC_20261117.md', import.meta.url), 'utf8');

describe('GH-5135 F10 visual regression: no opaque white 3x3 QuickBar over nighttime cockpit', () => {
  it('pins real V1/V2 S10 white-strip evidence and testable acceptance', () => {
    expect(spec).toContain('0.5708');
    expect(spec).toContain('0.0332');
    expect(spec).toContain('< 0.10');
  });
  it('uses contrasting translucent dark cards and compact one-line slots', () => {
    expect(compose).toContain('color = Color(0xD00C2230)');
    expect(compose).toContain('contentColor = Color(0xFFF0FAFF)');
    expect(compose).toContain('border = BorderStroke(1.dp, Color(0x6657C9EC))');
    expect(compose).toContain('tonalElevation = 0.dp');
    expect(compose).toContain('modifier = Modifier.size(sizing.iconDp.dp)');
    expect(compose).toContain('QuickBarSizing.forHeight(maxHeight.value, LocalDensity.current.fontScale)');
    expect(compose).toContain('lineHeight = (sizing.fontSp * 1.2f).sp');
    expect(compose).toContain('tint = Color(0xFF67D7F6)');
    expect(compose).toContain('overflow = TextOverflow.Ellipsis');
  });
  it('never drops 9 click/long-click callbacks for a cosmetic change', () => {
    expect(compose).toContain('repeat(3) { rowIndex ->');
    expect(compose).toContain('repeat(3) { columnIndex ->');
    expect(compose).toContain('onClick = { onClick(slot.index) }');
    expect(compose).toContain('onLongClick = { onLongClick(slot.index) }');
    expect(compose).toContain('contentDescription = title');
  });
});
