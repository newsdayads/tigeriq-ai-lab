import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicCopy = readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ LIVE manual reload', () => {
  it('keeps root and public UI exactly identical', () => {
    expect(root).toBe(publicCopy);
  });

  it('has one accessible vector reload control to the right of live connectivity', () => {
    const header = root.match(/<header class="top">([\s\S]*?)<\/header>/)?.[1] ?? '';
    expect(header).toContain('id="liveLabel"');
    expect(header).toContain('id="reloadPage"');
    expect(header.indexOf('id="reloadPage"')).toBeGreaterThan(header.indexOf('id="liveLabel"'));
    expect((root.match(/id="reloadPage"/g) ?? []).length).toBe(1);
    expect(header).toMatch(/<button[^>]*type="button"[^>]*aria-label="Tải lại trang"[^>]*>/);
    expect(header).toContain('<svg viewBox="0 0 24 24" aria-hidden="true"');
    expect(root).toContain('.reload-page:focus-visible');
    expect(root).toContain('@media(max-width:430px)');
  });

  it('wires a deliberate full-page reload without changing polling cadences', () => {
    expect(root).toContain("$('reloadPage').addEventListener('click',()=>window.location.reload());");
    expect(root).toContain('setInterval(()=>{if(!document.hidden)load()},10000);');
    expect(root).toContain('setInterval(()=>{if(!document.hidden)loadWorkforce()},5000);');
  });
});
