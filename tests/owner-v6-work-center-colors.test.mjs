import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/work-center.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/work-ui.css',import.meta.url),'utf8');
test('Owner V6 shared visual palette distinguishes real completion and working',()=>{
 assert.match(js,/WORKING:'#58A6FF'/);
 assert.match(js,/DONE:'#46D48F'/);
 assert.match(js,/QUEUED:'#F59E0B'/);
 assert.match(js,/BLOCKED:'#F43F5E'/);
});
test('CSS status bars correspond to V6 semantics, not old green working',()=>{
 for(const token of ['--tiq-live:#58a6ff','--tiq-done:#46d48f',
   '--tiq-queue:#efb85c','--tiq-review:#58a6ff'])
  assert.ok(css.includes(token),token);
 assert.match(css,/\.work-row\.status-waiting::before,.wo-card\.status-waiting::before\{background:var\(--tiq-queue\)\}/);
 assert.match(css,/\.work-row\.status-done::before,.wo-card\.status-done::before\{background:var\(--tiq-done\)\}/);
});
