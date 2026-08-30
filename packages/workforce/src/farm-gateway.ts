export type FarmDeviceState = 'online' | 'unauthorized' | 'offline' | 'unknown';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[], timeoutMs: number): Promise<CommandResult>;
}

export interface FarmDevice {
  serial: string;
  state: FarmDeviceState;
  model?: string;
  product?: string;
  transportId?: string;
  capabilities: string[];
}

function sanitizeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]/g, '');
}

export function parseAdbDevices(output: string): FarmDevice[] {
  const rows = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const devices: FarmDevice[] = [];
  for (const row of rows) {
    if (row.startsWith('List of devices attached')) continue;
    const [serialRaw, stateRaw, ...rest] = row.split(/\s+/);
    if (!serialRaw || !stateRaw) continue;
    const serial = sanitizeToken(serialRaw);
    if (!serial) continue;
    const state: FarmDeviceState = stateRaw === 'device'
      ? 'online'
      : stateRaw === 'unauthorized'
        ? 'unauthorized'
        : stateRaw === 'offline'
          ? 'offline'
          : 'unknown';
    const metadata = new Map<string, string>();
    for (const token of rest) {
      const split = token.indexOf(':');
      if (split <= 0) continue;
      metadata.set(token.slice(0, split), sanitizeToken(token.slice(split + 1)));
    }
    devices.push({
      serial,
      state,
      model: metadata.get('model') || undefined,
      product: metadata.get('product') || undefined,
      transportId: metadata.get('transport_id') || undefined,
      capabilities: state === 'online'
        ? ['adb', 'uiautomator2', 'screen-capture', 'app-restart']
        : [],
    });
  }
  return devices;
}

export class FarmGatewayAdapter {
  constructor(
    private readonly runner: CommandRunner,
    private readonly adbCommand = 'adb',
    private readonly defaultTimeoutMs = 15_000,
  ) {
    if (defaultTimeoutMs < 1_000 || defaultTimeoutMs > 120_000) {
      throw new Error('defaultTimeoutMs must be between 1000 and 120000');
    }
  }

  async inventory(): Promise<FarmDevice[]> {
    const result = await this.runner.run(this.adbCommand, ['devices', '-l'], this.defaultTimeoutMs);
    if (result.code !== 0) throw new Error(`adb inventory failed: ${result.stderr || result.code}`);
    return parseAdbDevices(result.stdout);
  }

  async restartApp(serial: string, packageName: string): Promise<void> {
    const safeSerial = sanitizeToken(serial);
    const safePackage = packageName.replace(/[^A-Za-z0-9._]/g, '');
    if (!safeSerial) throw new Error('serial is required');
    if (!safePackage) throw new Error('packageName is required');
    const stop = await this.runner.run(this.adbCommand, ['-s', safeSerial, 'shell', 'am', 'force-stop', safePackage], this.defaultTimeoutMs);
    if (stop.code !== 0) throw new Error(`adb force-stop failed: ${stop.stderr || stop.code}`);
    const start = await this.runner.run(this.adbCommand, ['-s', safeSerial, 'shell', 'monkey', '-p', safePackage, '-c', 'android.intent.category.LAUNCHER', '1'], this.defaultTimeoutMs);
    if (start.code !== 0) throw new Error(`adb app start failed: ${start.stderr || start.code}`);
  }

  async captureScreen(serial: string, remotePath = '/sdcard/tigeriq-evidence.png'): Promise<string> {
    const safeSerial = sanitizeToken(serial);
    const safePath = remotePath.replace(/[^A-Za-z0-9_./-]/g, '');
    if (!safeSerial) throw new Error('serial is required');
    if (!safePath.startsWith('/sdcard/')) throw new Error('evidence path must stay under /sdcard');
    const result = await this.runner.run(this.adbCommand, ['-s', safeSerial, 'shell', 'screencap', '-p', safePath], this.defaultTimeoutMs);
    if (result.code !== 0) throw new Error(`adb screencap failed: ${result.stderr || result.code}`);
    return safePath;
  }
}
