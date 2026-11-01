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

  it('recovers corrupt stored history with synchronous fail-visible cleanup', () => {
    const start = taxi.indexOf('private fun history(): JSONArray');
    const end = taxi.indexOf('private fun prependHistory', start);
    const block = taxi.slice(start, end);
    expect(block).toContain('Corrupt Taxi Meter history');
    expect(block).toContain('remove(TaxiMeterRules.KEY_HISTORY).commit()');
    expect(block).toContain('Failed to persist corrupt Taxi Meter history cleanup');
    expect(block).not.toContain('.apply()');
  });

  it('clears history only after durable persistence succeeds', () => {
    expect(taxi).toMatch(
      /remove\(TaxiMeterRules\.KEY_HISTORY\)\.commit\(\)[\s\S]*renderHistory\(\)[\s\S]*Đã xóa lịch sử Taxi Meter V2/,
    );
    expect(taxi).toContain('Không thể xóa lịch sử Taxi Meter V2');
  });

  it('preserves an active trip across Activity recreation without counting background time', () => {
    expect(taxi).toContain('restoreActiveTrip(savedInstanceState)');
    const save = taxi.slice(
      taxi.indexOf('override fun onSaveInstanceState(outState: Bundle)'),
      taxi.indexOf('override fun onResume()', taxi.indexOf('override fun onSaveInstanceState(outState: Bundle)')),
    );
    expect(save).toContain('outState.putBoolean(STATE_RUNNING, true)');
    expect(save).toContain('outState.putDouble(STATE_RATE_VND_PER_KM, rateVndPerKm)');
    expect(save).toContain('outState.putDouble(STATE_DISTANCE_METERS, distanceMeters)');
    expect(save).toContain('outState.putLong(STATE_ACTIVE_ELAPSED_MS, currentElapsedMs())');
    expect(save).toContain('outState.putLong(STATE_TRIP_STARTED_EPOCH_MS, tripStartedEpochMs)');

    const restore = taxi.slice(
      taxi.indexOf('private fun restoreActiveTrip(state: Bundle?)'),
      taxi.indexOf('private fun enabledProviders', taxi.indexOf('private fun restoreActiveTrip(state: Bundle?)')),
    );
    expect(restore).toContain('TaxiMeterRules.validActiveTripState(');
    expect(restore).toContain('foregroundSegmentStartedMs = 0L');
    expect(restore).toContain('lastLocation = null');
    expect(restore).toContain('running = true');
    expect(restore).toContain('rateInput.isEnabled = false');
    expect(restore).toContain('toggleButton.text = "Kết thúc chuyến"');

    const resume = taxi.slice(
      taxi.indexOf('override fun onResume()'),
      taxi.indexOf('override fun onStop()', taxi.indexOf('override fun onResume()')),
    );
    expect(resume).toContain('foregroundSegmentStartedMs = SystemClock.elapsedRealtime()');
    expect(resume).toContain('handler.post(tick)');
    expect(resume).toContain('startLocationUpdates()');
  });
});
