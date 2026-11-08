import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Agent Desktop Windows UI bridge: UTF-8 and MCP evidence', () => {
  it('decodes broker request JSON as UTF-8 (Windows PowerShell 5.1 defaults to ANSI)', async () => {
    const broker = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(broker).toContain('$req = Get-Content -LiteralPath $item.FullName -Raw -Encoding UTF8 | ConvertFrom-Json');
    expect(broker).not.toContain('$req = Get-Content -LiteralPath $item.FullName -Raw | ConvertFrom-Json');
    expect(broker).toContain("'pad_android_sign_v020' { return Invoke-V020Signer }");
    expect(broker).toContain("'nv07_native_session_ping' {");
  });

  it('decodes native JSON and sends non-ASCII input as UTF-8', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/agent-desktop-ui.ps1', import.meta.url), 'utf8');
    expect(source).toContain('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)');
    expect(source).toContain('$OutputEncoding = New-Object System.Text.UTF8Encoding($false)');
    expect(source).toContain("Invoke-TigerIQAgentDesktopCli -Arguments @('set-value',$ref,'--stdin') -StdinText $value");
    expect(source).toContain("$PSBoundParameters.ContainsKey('StdinText')");
    expect(source).toContain('$proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)');
    expect(source).toContain('agent-desktop-win32-x64.exe');
    expect(source).not.toContain('cmd /c agent-desktop');
  });

  it('attributes interactive UI to Agent Desktop, not Power Automate', async () => {
    const op = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(op).toContain("'Agent Desktop via existing Windows interactive broker'");
    expect(op).not.toContain("interactiveUiScope: PAD_UI_ACTIONS.includes(action) ? 'Power Automate Desktop only'");
    const mcp = await readFile(new URL('../apps/tigeriq-core/pc-operator-mcp.mjs', import.meta.url), 'utf8');
    expect(mcp).toContain('giữ tên lệnh pad_* tương thích hệ thống cũ');
    expect(mcp).toContain("action: 'pad_windows'");
  });
});
