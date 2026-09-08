import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../copybox.html', import.meta.url), 'utf8');

describe('TigerIQ CopyBox static contract', () => {
  it('keeps the copy surface fixed-height with internal scrolling', () => {
    expect(html).toContain('height:220px');
    expect(html).toContain('max-height:220px');
    expect(html).toContain('overflow:auto');
    expect(html).toContain('resize:none');
  });

  it('copies the complete value instead of truncating visible content', () => {
    expect(html).toContain("navigator.clipboard.writeText(text.value)");
    expect(html).not.toContain('slice(0,');
    expect(html).not.toContain('substring(');
  });

  it('supports private client-side payload loading without network requests', () => {
    expect(html).toContain("location.hash.slice(1)");
    expect(html).toContain("params.get('text')");
    expect(html).toContain("params.get('b64')");
    expect(html).not.toMatch(/fetch\s*\(/);
    expect(html).not.toMatch(/XMLHttpRequest/);
  });

  it('uses Vietnamese labels and no external assets', () => {
    expect(html).toContain('Sao chép');
    expect(html).toContain('Đã sao chép toàn bộ.');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });
});
