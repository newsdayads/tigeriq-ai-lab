import { describe, expect, it } from 'vitest';
import { assertShellCommandAllowed, resolveOperatorPath } from '../apps/openclaw-tigeriq-runtime/operator.mjs';

describe('OpenClaw PC01 guarded local operator', () => {
  it('allows TigerIQ/OpenClaw work roots', () => {
    expect(resolveOperatorPath('D:\\TigerIQ\\Workspace\\repo')).toBe('D:\\TigerIQ\\Workspace\\repo');
    expect(resolveOperatorPath('D:\\OpenClaw\\npm-global')).toBe('D:\\OpenClaw\\npm-global');
    expect(resolveOperatorPath('D:\\TigerIQ-OpenClaw\\state')).toBe('D:\\TigerIQ-OpenClaw\\state');
  });

  it('blocks paths outside operator roots and sensitive stores', () => {
    expect(() => resolveOperatorPath('C:\\Windows\\System32')).toThrow('TIGERIQ_PC_PATH_NOT_ALLOWED');
    expect(() => resolveOperatorPath('D:\\TigerIQ\\Secrets\\x.txt')).toThrow('TIGERIQ_PC_SENSITIVE_PATH_BLOCKED');
  });

  it('allows normal operator shell work', () => {
    expect(assertShellCommandAllowed('git status')).toBe('git status');
    expect(assertShellCommandAllowed('Get-Process | Select-Object -First 5')).toContain('Get-Process');
    expect(assertShellCommandAllowed('Get-ChildItem D:\\TigerIQ\\State')).toContain('D:\\TigerIQ\\State');
  });

  it('blocks destructive/system/Production/direct-main mutations by default', () => {
    for (const command of [
      'shutdown /s /t 0',
      'Remove-Item D:\\TigerIQ\\Workspace\\x.txt',
      'del D:\\TigerIQ\\Workspace\\x.txt',
      'git reset --hard HEAD~1',
      'git clean -fd',
      'Stop-Process -Name node',
      'Start-Process powershell.exe',
      'powershell.exe -EncodedCommand AAAA',
      'git push origin main',
      'vercel deploy --prod',
      'gh pr merge 123',
      'type D:\\TigerIQ\\Secrets\\github-command-center.token',
    ]) {
      expect(() => assertShellCommandAllowed(command)).toThrow('TIGERIQ_PC_COMMAND_REQUIRES_OWNER_APPROVAL');
    }
  });

  it('blocks explicit shell paths outside TigerIQ/OpenClaw roots', () => {
    expect(() => assertShellCommandAllowed('Get-ChildItem C:\\Windows')).toThrow('TIGERIQ_PC_COMMAND_PATH_NOT_ALLOWED');
  });
});
