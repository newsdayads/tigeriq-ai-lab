import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('PAD UI broker targeted selector fast path', () => {
  it('resolves PID directly before broad desktop enumeration', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('function Get-PadWindowByProcessId($Request)');
    expect(source).toContain('Get-Process -Id $pidValue -ErrorAction Stop');
    expect(source).toContain('[System.Windows.Automation.AutomationElement]::FromHandle($handle)');

    const topStart = source.indexOf('function Get-TopWindowElement($Request)');
    const topEnd = source.indexOf('function Element-ToObject($e)');
    const topWindow = source.slice(topStart, topEnd);
    expect(topWindow.indexOf('Get-PadWindowByProcessId $Request')).toBeGreaterThanOrEqual(0);
    expect(topWindow.indexOf('Get-PadWindowByProcessId $Request')).toBeLessThan(topWindow.indexOf('RootElement'));
  });

  it('uses exact UIAutomation property conditions before descendant filtering', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('function Get-PadSearchCondition($Request, [string]$Mode)');
    expect(source).toContain('AutomationIdProperty');
    expect(source).toContain('NameProperty');
    expect(source).toContain('$searchCondition = Get-PadSearchCondition $Request $mode');
    expect(source).toContain('$window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $searchCondition)');
  });
});
