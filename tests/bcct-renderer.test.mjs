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


it('renders V6 evidence-backed progress and mobile-friendly real links without dispatch',()=>{
 const report={generatedAt:'2026-10-14T04:00:00Z',sourceVerified:true,sourceFresh:true,workOrders:[
   {id:'GH-4625',goal:'[P1] DeXCam Personal',status:'waiting',
    progress:{verified:true,completed:4,total:30,evidenceUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/4625'},
    blocker:'Hardware E2E pending',nextAction:'Verify source safely'},
   {id:'GH-2293',goal:'[P2] Revenue Lab',status:'verified',
    progress:{verified:true,completed:3,total:3,evidenceUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/2293'}}
 ]};
 const out=renderBcctV4(report,'Tất cả');
 expect(out.ok).toBe(true);
 expect(out.html).toContain('aria-valuenow="13"');
 expect(out.html).toContain('4/30 mốc');
 expect(out.html).toContain('<details>');
 expect(out.html).toContain('HỒ SƠ');
 expect(out.html).toContain('TẢI LẠI TRANG');
 expect(out.html).toContain('CHỜ NGHIỆM THU CUỐI');
 expect(out.html).not.toContain('aria-valuenow="100"');
 expect(out.html).not.toContain('LÀM NGAY');
});
it('does not invent progress or allow HTML injection in V6 drilldown',()=>{
 const out=renderBcctV4({generatedAt:data.generatedAt,workOrders:[
  {id:'GH-123',goal:'[P1] <img src=x onerror=alert(1)>',status:'working',
   blocker:'<script>alert(1)</script>',nextAction:'<b>fake</b>'}
 ]},'Tất cả');
 expect(out.ok).toBe(true);
 expect(out.html).toContain('CHƯA ĐỦ DỮ LIỆU TÍNH %');
 expect(out.html).not.toContain('aria-valuenow=');
 expect(out.html).not.toContain('<script>alert(1)</script>');
 expect(out.html).not.toContain('<img src=x');
 expect(out.html).toContain('&lt;script&gt;');
 expect(out.html).toContain('CHƯA XÁC MINH');
});
