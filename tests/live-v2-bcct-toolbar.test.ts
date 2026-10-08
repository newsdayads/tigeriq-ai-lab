import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
const root=readFileSync('command-center.html','utf8');
const mirrored=readFileSync('public/command-center.html','utf8');
test('LIVE V2 public/root content is mirrored',()=>expect(mirrored).toBe(root));
test('BCCT priority filter and refresh controls are wired',()=>{
 expect(root).toContain('id="bcctSort"');
 expect(root).toContain('value="priority"');
 expect(root).toContain('value="ready"');
 expect(root).toContain("$('bcctSort').addEventListener('change',render)");
 expect(root).toContain("$('bcctRefresh').addEventListener('click',load)");
});
test('BCCT toolbar does not impersonate Core dispatch',()=>{
 const toolbar=root.match(/<div class="bcct-toolbar">[^\n]+<\/div>/)?.[0]??'';
 expect(toolbar).toContain('không tự giao việc');
 expect(toolbar).not.toMatch(/LÀM NGAY|dispatch|GIAO NHÂN SỰ/);
 expect(root).toContain("fetch('/api/live-status',{cache:'no-store'})");
});
