// GH-5135 F12 — bounded OBD Bluetooth session lifecycle source contract.
// Source-only evidence; does not prove a real adapter/vehicle connection.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const obd = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/ObdActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F12 OBD session lifecycle', () => {
  it('closes a candidate socket when connection or initialization fails before publication', () => {
    const start = obd.indexOf('private fun connect(device: BluetoothDevice)');
    const end = obd.indexOf('private fun initializeAdapter', start);
    const block = obd.slice(start, end);
    expect(block).toContain('var candidate: BluetoothSocket? = null');
    expect(block).toContain('candidate = active');
    expect(block).toContain('active.connect()');
    expect(block).toContain('initializeAdapter(active)');
    expect(block.indexOf('initializeAdapter(active)')).toBeLessThan(block.indexOf('socket = active'));
    expect(block).toContain('try { candidate?.close() } catch (_: Exception) { }');
  });

  it('does not publish a connected socket after Activity stop or destruction', () => {
    expect(obd).toContain('@Volatile private var activityStarted = false');
    expect(obd).toContain('override fun onStart()');
    expect(obd).toContain('activityStarted = true');
    expect(obd).toContain('activityStarted = false');
    const start = obd.indexOf('private fun connect(device: BluetoothDevice)');
    const end = obd.indexOf('private fun initializeAdapter', start);
    const block = obd.slice(start, end);
    expect(block).toContain('if (!activityStarted || isFinishing || isDestroyed)');
    expect(block).toContain('try { active.close() } catch (_: Exception) { }');
    expect(block.indexOf('if (!activityStarted || isFinishing || isDestroyed)')).toBeLessThan(
      block.indexOf('socket = active'),
    );
  });

  it('marshals connected UI and telemetry handoff onto the UI thread with lifecycle guard', () => {
    const start = obd.indexOf('private fun connect(device: BluetoothDevice)');
    const end = obd.indexOf('private fun initializeAdapter', start);
    const block = obd.slice(start, end);
    const uiStart = block.indexOf('runOnUiThread {');
    expect(uiStart).toBeGreaterThanOrEqual(0);
    const uiBlock = block.slice(uiStart);
    expect(uiBlock).toContain('socket !== active');
    expect(uiBlock).toContain('setConnection("OBD: đã kết nối")');
    expect(uiBlock).toContain('updateButtons()');
    expect(uiBlock).toContain('queryTelemetry()');
  });
});
