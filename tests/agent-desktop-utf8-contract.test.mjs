import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Agent Desktop Windows UI bridge: UTF-8 and MCP evidence', () => {
  it('decodes native JSON and sends non-ASCII input as UTF-8', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/agent-desktop-ui.ps1', import.meta.url), 'utf8');
    expect(source).toContain('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)');
    expect(source).toContain('$OutputEncoding = New-Object System.Text.UTF8Encoding($false)');
    expect(source).toContain("Invoke-TigerIQAgentDesktopCli @('set-value',$ref,'--stdin') $value");
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
