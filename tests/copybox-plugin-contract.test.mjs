import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const server = readFileSync(new URL('../apps/copybox-plugin/server.js', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../apps/copybox-plugin/public/copybox-widget.html', import.meta.url), 'utf8');

describe('TigerIQ CopyBox MCP Apps contract', () => {
  it('registers a UI resource and one copybox tool without truncating input', () => {
    expect(server).toContain("'show_copybox'");
    expect(server).toContain("'ui://tigeriq/copybox/v1.html'");
    expect(server).toContain('structuredContent: { text }');
    expect(server).not.toContain('slice(');
    expect(server).not.toContain('substring(');
  });

  it('binds locally by default and exposes only the MCP path', () => {
    expect(server).toContain("listen(port, '127.0.0.1'");
    expect(server).toContain("const MCP_PATH = '/mcp'");
  });

  it('keeps the embedded widget compact and scrollable', () => {
    expect(widget).toContain('height:190px');
    expect(widget).toContain('max-height:190px');
    expect(widget).toContain('overflow:auto');
    expect(widget).toContain('navigator.clipboard.writeText(value)');
  });

  it('uses the MCP Apps bridge and no external assets', () => {
    expect(widget).toContain("request('ui/initialize'");
    expect(widget).toContain("ui/notifications/tool-result");
    expect(widget).not.toMatch(/<script[^>]+src=/);
    expect(widget).not.toMatch(/<link[^>]+href=/);
  });
});
