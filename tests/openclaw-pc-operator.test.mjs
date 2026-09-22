import { describe, expect, it } from 'vitest';
import {
  assertShellCommandAllowed,
  assertTigerIQTaskName,
  assertWritePathAllowed,
  resolveOperatorPath,
} from '../apps/openclaw-tigeriq-runtime/operator.mjs';

describe('OpenClaw PC01 guarded local operator', () => {
  it('allows TigerIQ/OpenClaw work roots', () => {
    expect(resolveOperatorPath('D:\\TigerIQ\\Evidence\\x.json')).toBe('D:\\TigerIQ\\Evidence\\x.json');
    expect(resolveOperatorPath('D:\\OpenClaw\\npm-global')).toBe('D:\\OpenClaw\\npm-global');
    expect(resolveOperatorPath('D:\\TigerIQ-OpenClaw\\state')).toBe('D:\\TigerIQ-OpenClaw\\state');
  });

  it('blocks paths outside operator roots and sensitive stores', () => {
    expect(() => resolveOperatorPath('C:\\Windows\\System32')).toThrow('TIGERIQ_PC_PATH_NOT_ALLOWED');
    expect(() => resolveOperatorPath('D:\\TigerIQ\\Secrets\\x.txt')).toThrow('TIGERIQ_PC_SENSITIVE_PATH_BLOCKED');
  });

  it('blocks direct source/runtime-source writes while allowing state/evidence writes', () => {
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\Workspace\\tigeriq-ai-lab\\x.txt')).toThrow('TIGERIQ_PC_SOURCE_WRITE_BLOCKED');
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\Runtime\\CoreSource\\x.txt')).toThrow('TIGERIQ_PC_SOURCE_WRITE_BLOCKED');
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\State\\x.json')).not.toThrow();
  });

  it('allows only a narrow diagnostic shell command set', () => {
    expect(assertShellCommandAllowed('git status')).toBe('git status');
    expect(assertShellCommandAllowed('ollama ps')).toBe('ollama ps');
    expect(assertShellCommandAllowed('openclaw plugins inspect tigeriq-runtime --json')).toContain('tigeriq-runtime');
    for (const command of [
      'Get-Process | Select-Object -First 5',
      'Get-ChildItem C:\\',
      'echo $env:GH_TOKEN',
      'cmd /c whoami',
      'shutdown /s /t 0',
      'Remove-Item D:\\TigerIQ\\Workspace -Recurse -Force',
      'git push origin main',
      'vercel deploy --prod',
      'gh pr merge 123',
      'type D:\\TigerIQ\\Secrets\\github-command-center.token',
    ]) {
      expect(() => assertShellCommandAllowed(command)).toThrow('TIGERIQ_PC_COMMAND_NOT_ALLOWLISTED');
    }
  });

  it('limits scheduled-task actions to TigerIQ task names', () => {
    expect(assertTigerIQTaskName('TigerIQ OpenClaw Gateway')).toBe('TigerIQ OpenClaw Gateway');
    expect(() => assertTigerIQTaskName('Microsoft\\Windows\\Defrag\\ScheduledDefrag')).toThrow('TIGERIQ_PC_TASK_NOT_ALLOWED');
  });
});
