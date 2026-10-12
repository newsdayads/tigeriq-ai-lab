import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root=readFileSync(new URL('../command-center.html',import.meta.url),'utf8');
const mirror=readFileSync(new URL('../public/command-center.html',import.meta.url),'utf8');
const common=readFileSync(new URL('../public/work-center.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../public/work-ui.css',import.meta.url),'utf8');

describe('TigerIQ LIVE reload — P0 floating utility',()=>{
 it('maintains root/public parity and keeps LIVE status unobstructed',()=>{
  expect(root).toBe(mirror);
  const header=root.match(/<header class="top">([\s\S]*?)<\/header>/)?.[1]??'';
  expect(header).toContain('id="liveLabel"');
  expect(header).not.toContain('id="reloadPage"');
 });
 it('mounts one accessible one-tap floating control at lower-right',()=>{
  expect(root).toContain('TigerIQWorkCenter.mountFloatingReload();');
  expect(root).toContain('<script src="/work-center.js"></script>');
  expect(common).toContain("button.id='reloadPage'");
  expect(common).toContain("button.setAttribute('aria-label','Tải lại trang')");
  expect(common).toContain("root.location.reload()");
  expect(styles).toContain('.tiq-floating-reload{position:fixed;right:');
  expect(styles).toContain('bottom:calc(20px + env(safe-area-inset-bottom))');
  expect(styles).toContain('drawer-open .tiq-floating-reload');
 });
 it('keeps fast read-only polling cadence unchanged',()=>{
  expect(root).toContain('setInterval(()=>{if(!document.hidden)load()},10000);');
  expect(root).toContain('setInterval(()=>{if(!document.hidden)loadWorkforce()},5000);');
 });
});
