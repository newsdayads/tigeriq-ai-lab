import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/', import.meta.url);
const home = readFileSync(new URL('HomeActivity.kt', base), 'utf8');
const art = readFileSync(new URL('HomeFallbackVisuals.kt', base), 'utf8');

describe('GH-5135 virtual second-display screenshot gap: original V2 fallback visuals', () => {
  it('always prefers owner-licensed V2 media over any illustrated placeholder', () => {
    expect(home).toContain('if (optionalImage(name, 0f, 0f, 1f, 1f, ImageView.ScaleType.FIT_XY)) return');
    expect(home).toContain('if (optionalImage(name, left, top, width, height)) return');
    expect(home).toContain('RoadCityFallbackView(this, night)');
    expect(home).toContain('ParkedVehicleFallbackView(this, vehicleModel)');
  });
  it('draws originally constructed road perspective, city skyline and two vehicle variants', () => {
    expect(art).toContain('skyline.lineTo');
    expect(art).toContain('road.moveTo');
    expect(art).toContain('LinearGradient(');
    expect(art).toContain('RadialGradient(');
    expect(art).toContain('vehicleModel == VehicleRules.MODEL_LIMO_RED');
    expect(art).not.toContain('com.tigeriq.dexsplit');
    expect(art).not.toContain('getAssetsFromV1');
  });
  it('does not claim original V1 art, real camera, GPS or vehicle geometry', () => {
    expect(art).toContain('NOT the original');
    expect(art).toContain('original illustrative artwork');
    expect(art).not.toContain('grantCameraPermission');
    expect(art).not.toContain('simulateGearR');
  });
});
