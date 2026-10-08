import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
const root=readFileSync('command-center.html','utf8');
const mirrored=readFileSync('public/command-center.html','utf8');

test('LIVE P0 root/public HTML remain identical',()=>{
  expect(mirrored).toBe(root);
});
test('Owner-approved LIVE removes only dropdown toolbar, preserves status navigation',()=>{
  for(const id of ['bcctSort','workProjectFilter','workStatusFilter','workPriorityFilter','bcctRefresh']){
    expect(root).not.toContain('id="'+id+'"');
  }
  expect(root).not.toContain('class="bcct-toolbar owner-filter-toolbar"');
  expect(root).toContain('data-filter="running"');
  expect(root).toContain('data-filter="done"');
  expect(root).toContain('data-filter="system"');
  expect(root).toContain('id="workList"');
});
test('LIVE employee cards appear before jobs and follow verified PC01 snapshot',()=>{
  expect(root).toContain('id="liveWorkers"');
  expect(root.indexOf('id="liveWorkers"')).toBeLessThan(root.indexOf('id="workListHeading"'));
  expect(root).toContain('function renderLiveWorkers()');
  expect(root).toContain('renderLiveWorkers();');
  expect(root).toContain('workforceSnapshot||snapshot');
  expect(root).toContain("source?.liveConnected===true");
  expect(root).toContain("worker?.currentJobId");
  expect(root).toContain("worker?.heartbeatAt");
  expect(root).toContain("fetch('/api/live-status?scope=workforce',{cache:'no-store'})");
  expect(root).toContain("setInterval(()=>{if(!document.hidden)loadWorkforce()},5000)");
  expect(root).toContain("setInterval(()=>{if(!document.hidden)load()},10000)");
  expect(root).toContain("grid.insertBefore(card,grid.children[index]||null)");
  expect(root).toContain("worker.currentJobId");
  expect(root).toMatch(/@media\(max-width:1099px\)\{\.live-workers-grid\{grid-template-columns:repeat\(2,/);
  expect(root).toMatch(/@media\(max-width:599px\)\{\.live-workers-grid\{grid-template-columns:minmax\(0,1fr\)/);
  expect(root).toContain("fetch('/api/live-status',{cache:'no-store'})");
  expect(root).not.toContain("document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter===currentFilter))");
});
