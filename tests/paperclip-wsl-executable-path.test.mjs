import { describe, expect, it } from 'vitest';
import { paperclipFixedExecutableForPlatform } from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

describe('Paperclip: WSL system executable on Windows', () => {
  it('uses the actual SystemRoot path, not the worker PATH, for wsl.exe', () => {
    expect(paperclipFixedExecutableForPlatform('wsl.exe', {
      platform: 'win32', systemRoot: 'C:\\Windows',
    })).toBe('C:\\Windows\\System32\\wsl.exe');
    expect(paperclipFixedExecutableForPlatform('wsl.exe', {
      platform: 'win32', systemRoot: 'D:\\Windows',
    })).toBe('D:\\Windows\\System32\\wsl.exe');
  });

  it('leaves other commands and non-Windows test hosts untouched', () => {
    expect(paperclipFixedExecutableForPlatform('docker.exe', {
      platform: 'win32', systemRoot: 'C:\\Windows',
    })).toBe('docker.exe');
    expect(paperclipFixedExecutableForPlatform('wsl.exe', {
      platform: 'linux', systemRoot: 'C:\\Windows',
    })).toBe('wsl.exe');
  });

  it('fails closed to legacy command resolution for missing or unsafe system roots', () => {
    for (const systemRoot of ['', '\\\\server\\Windows', 'C:\\Windows\\..\\Temp', 'C:\\Temp']) {
      expect(paperclipFixedExecutableForPlatform('wsl.exe', {
        platform: 'win32', systemRoot,
      })).toBe('wsl.exe');
    }
  });
});
