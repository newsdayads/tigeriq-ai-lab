import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
const root = readFileSync('command-center.html','utf8');
const publicCopy = readFileSync('public/command-center.html','utf8');
test('public and root Owner LIVE interfaces are exact mirrors', () => { expect(publicCopy).toBe(root); });
test('P0-P5 and queue sorting controls are user-visible and wired', () => {
  expect(root).toContain('id="bcctSort"');
  expect(root).toContain('<option value="priority">P0–P5</option>');
  expect(root).toContain('<option value="queue">HÀNG ĐỢI TRƯỚC</option>');
  expect(root).toContain("$('bcctSort').addEventListener('change',render)");
  expect(root).toContain("$('bcctRefresh').addEventListener('click',load)");
});
test('read-only controls cannot claim to dispatch Core jobs', () => {
  const toolbar = root.match(/<div class="bcct-toolbar">[^\n]+<\/div>/)?.[0] ?? '';
  expect(toolbar).toContain('không thực thi Core');
  expect(toolbar).not.toMatch(/LÀM NGAY|DISPATCH|dispatch|id="executeWork"/);
  expect(root).toContain("fetch('/api/live-status',{cache:'no-store'})");
});
