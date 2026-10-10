import {describe,it,expect} from 'vitest';
import { buildBcctReport,renderBcctV4 } from '../apps/dashboard/src/bcct.mjs';

const data={generatedAt:'2026-10-09T03:00:00Z',workOrders:[
 {id:'GH-4569',goal:'[P0] Khóa biểu tượng vector',status:'blocked'},
 {id:'GH-4592',goal:'[P1] BCCT',status:'verified'}
]};
describe('first-call live BCCT renderer path',()=>{
 it('validates and emits six sections plus five RDC fallback rows',()=>{
  const out=renderBcctV4(data,'Tất cả','newsdayads/tigeriq-ai-lab');
  expect(out.ok).toBe(true);
  expect(out.html).toContain('RDC05');
  expect(out.html).toContain('6. Mốc kế tiếp');
  expect(out.html).toContain('href="/bcct?filter=P0"');
 });
 it('filters real GitHub work items on first request',()=>{
  const report=buildBcctReport(data,'P0');
  expect(report.jobs.map(j=>j.issue)).toEqual([4569]);
 });
 it('does not claim live RDC status without verification',()=>{
  const report=buildBcctReport(data);
  expect(report.rdc).toHaveLength(5);
  expect(report.rdc.every(a=>a.pc01==='CHƯA XÁC MINH'&&a.remainingPct===null)).toBe(true);
 });
 it('escapes source work-order HTML and does not inject script',()=>{
  const out=renderBcctV4({generatedAt:data.generatedAt,workOrders:[{id:'GH-1',goal:'<script>alert(1)</script>',status:'blocked'}]},'Tất cả');
  expect(out.ok).toBe(true);
  expect(out.html).not.toContain('<script>');
  expect(out.html).toContain('&lt;script&gt;');
 });
});
