import { describe, expect, it } from 'vitest';
import { FarmGatewayAdapter, parseAdbDevices, type CommandRunner } from '../packages/workforce/src/farm-gateway.js';

describe('Farm Gateway adapter', () => {
  it('parses adb inventory and maps safe capabilities', () => {
    const devices = parseAdbDevices(`List of devices attached\nABC123 device product:gts model:SM_G930F transport_id:1\nXYZ999 unauthorized usb:2-1\nOFF1 offline\n`);
    expect(devices).toEqual([
      { serial: 'ABC123', state: 'online', product: 'gts', model: 'SM_G930F', transportId: '1', capabilities: ['adb', 'uiautomator2', 'screen-capture', 'app-restart'] },
      { serial: 'XYZ999', state: 'unauthorized', model: undefined, product: undefined, transportId: undefined, capabilities: [] },
      { serial: 'OFF1', state: 'offline', model: undefined, product: undefined, transportId: undefined, capabilities: [] },
    ]);
  });

  it('uses argv boundaries instead of shell strings for app restart', async () => {
    const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
    const runner: CommandRunner = {
      async run(command, args, timeoutMs) {
        calls.push({ command, args, timeoutMs });
        return { code: 0, stdout: '', stderr: '' };
      },
    };
    const gateway = new FarmGatewayAdapter(runner);
    await gateway.restartApp('ABC123', 'ai.tigeriq.worker');
    expect(calls).toEqual([
      { command: 'adb', args: ['-s', 'ABC123', 'shell', 'am', 'force-stop', 'ai.tigeriq.worker'], timeoutMs: 15_000 },
      { command: 'adb', args: ['-s', 'ABC123', 'shell', 'monkey', '-p', 'ai.tigeriq.worker', '-c', 'android.intent.category.LAUNCHER', '1'], timeoutMs: 15_000 },
    ]);
  });

  it('constrains evidence capture to /sdcard and sanitizes injection characters', async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = {
      async run(_command, args) {
        calls.push(args);
        return { code: 0, stdout: '', stderr: '' };
      },
    };
    const gateway = new FarmGatewayAdapter(runner);
    await expect(gateway.captureScreen('ABC;rm -rf /', '/tmp/x.png')).rejects.toThrow('evidence path must stay under /sdcard');
    const path = await gateway.captureScreen('ABC;rm -rf /', '/sdcard/evidence-1.png');
    expect(path).toBe('/sdcard/evidence-1.png');
    expect(calls[0]).toEqual(['-s', 'ABCrm-rf', 'shell', 'screencap', '-p', '/sdcard/evidence-1.png']);
  });

  it('fails closed when adb inventory fails', async () => {
    const runner: CommandRunner = {
      async run() { return { code: 1, stdout: '', stderr: 'adb unavailable' }; },
    };
    await expect(new FarmGatewayAdapter(runner).inventory()).rejects.toThrow('adb inventory failed');
  });
});
