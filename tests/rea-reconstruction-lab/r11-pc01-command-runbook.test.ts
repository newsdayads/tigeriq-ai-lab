import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const runbook = readFileSync(resolve('projects/rea-reconstruction-lab/R04_DEPLOYMENT_ROLLBACK_RUNBOOK.md'), 'utf8');
const current = runbook.split('## 1. Bản cố định và điều kiện đầu vào')[0];
const command = current.match(/```powershell\n([\s\S]*?)```/)?.[1] ?? '';

it('documents live PC01 6.5.0 separately from historical R04 6.4.0 pin', () => {
  expect(current).toContain('REA 6.5.0');
  expect(runbook).toContain('rea-agents@6.4.0');
  expect(runbook).toContain('a56f7bb668ab23fec8d33f7af353ac7ed2fe1895');
});

it('invokes the absolute rea.cmd path instead of assuming PATH', () => {
  expect(command).toContain("$reaCmd = 'D:\\TigerIQ\\Tools\\rea-agent\\rea.cmd'");
  expect(command).toContain('Test-Path -LiteralPath $reaCmd -PathType Leaf');
  expect(command).toContain('& $reaCmd --version');
  expect(command).toContain('& $reaCmd mcp doctor');
  expect(current).toContain('Get-Command rea');
});

it('fails closed for missing command or failure of version and doctor checks', () => {
  expect(command).toContain("throw 'REA_CMD_NOT_FOUND'");
  expect(command).toContain("throw 'REA_VERSION_CHECK_FAILED'");
  expect(command).toContain("throw 'REA_MCP_DOCTOR_FAILED'");
  expect((command.match(/\$LASTEXITCODE -ne 0/g) ?? [])).toHaveLength(2);
});

it('does not persist PATH, install dependencies, or claim owner R11 acceptance', () => {
  expect(command).not.toMatch(/SetEnvironmentVariable|setx\b|reg(?:\.exe)?\s+add|rea\s+(?:install|setup|update)|Start-Process|Invoke-Expression|iex\b/i);
  expect(current).toContain('không nghiệm thu');
  expect(current).toContain('Owner acceptance');
  expect(current).toContain('issues/4780#issuecomment-6238265562');
});
