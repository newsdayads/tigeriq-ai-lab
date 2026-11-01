// GH-5135 F13: source contract for durable Taxi Meter V2 persistence.
// This is source-only evidence, not GPS/device acceptance or V1 tariff parity.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const taxi = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/TaxiMeterActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F13 Taxi Meter persistence source contract', () => {
  it('persists the configured rate before a trip can start', () => {
    const start = taxi.indexOf('private fun startTrip()');
    const end = taxi.indexOf('private fun enabledProviders', start);
    const block = taxi.slice(start, end);

    expect(block).toContain('putString(TaxiMeterRules.KEY_RATE, parsedRate.toString()).commit()');
    expect(block).toContain('Không thể lưu giá/km — chưa bắt đầu chuyến');
    expect(block.indexOf('.commit()')).toBeLessThan(block.indexOf('running = true'));
    expect(block).not.toContain('.apply()');
  });

  it('commits a completed trip before refreshing or acknowledging saved history', () => {
    const finish = taxi.slice(
      taxi.indexOf('private fun finishTrip(save: Boolean)'),
      taxi.indexOf('private fun history()', taxi.indexOf('private fun finishTrip(save: Boolean)')),
    );
    expect(finish).toContain('if (prependHistory(record))');
    expect(finish).toContain('toast("Đã lưu chuyến Taxi Meter V2")');
    expect(finish).toContain('toast("Không thể lưu lịch sử chuyến Taxi Meter V2")');

    const prepend = taxi.slice(
      taxi.indexOf('private fun prependHistory(record: JSONObject): Boolean'),
      taxi.indexOf('private fun writeTripReport', taxi.indexOf('private fun prependHistory(record: JSONObject): Boolean')),
    );
    expect(prepend).toContain('putString(TaxiMeterRules.KEY_HISTORY, next.toString())');
    expect(prepend).toContain('.commit()');
    expect(prepend).not.toContain('.apply()');
  });

  it('clears history only after durable persistence succeeds', () => {
    expect(taxi).toMatch(
      /remove\(TaxiMeterRules\.KEY_HISTORY\)\.commit\(\)[\s\S]*renderHistory\(\)[\s\S]*Đã xóa lịch sử Taxi Meter V2/,
    );
    expect(taxi).toContain('Không thể xóa lịch sử Taxi Meter V2');
  });
});
