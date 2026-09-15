import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const ui=readFileSync('apps/tigeriq-core/web-control-unified.js','utf8');
const html=readFileSync('apps/tigeriq-core/web-control.html','utf8');
const css=readFileSync('apps/tigeriq-core/web-control-unified.css','utf8');

describe('#777 Web Control routing/resource projection',()=>{
  it('extends the existing unified Web Control and separates employees from AI resources',()=>{
    expect(ui).toContain('window.__tigerIqUnifiedWebControl');
    expect(ui).toContain('Định tuyến AI');
    expect(ui).toContain('Hiệu suất theo loại việc');
    expect(ui).toContain('Tài nguyên AI');
    expect(ui).toContain('tqUResources');
    expect(ui).toContain('resources.map(richResourceCard)');
    expect(ui).toContain('canonicalEmployees');
    expect(ui).toContain('renderWorkers = renderCanonicalWorkers');
    expect(ui).not.toContain('workerCard = richResourceCard');
    expect(html).toContain('Danh sách NV canonical theo Registry');
  });
  it('shows stable resource identity, provider/model, quota and routing evidence from Core truth',()=>{
    expect(ui).toContain('r.resource_id');
    expect(ui).toContain('r.quota_state');
    expect(ui).toContain('routingDecisions');
    expect(ui).toContain('performanceByTask');
    expect(ui).toContain('ROUTING_FAILOVER');
    expect(ui).toContain('chosen.reasons');
  });
  it('has explicit truthful empty states instead of fake charts/data',()=>{
    expect(ui).toContain('Chưa đủ dữ liệu thật để vẽ biểu đồ.');
    expect(ui).toContain('Chưa có quyết định định tuyến thật từ Core.');
    expect(ui).toContain('Chưa có dữ liệu hiệu suất thật theo loại việc.');
    expect(ui).toContain('Hạn mức chưa có dữ liệu');
  });
  it('keeps responsive layouts and readable minimum text sizes',()=>{
    expect(css).toContain('@media(max-width:1500px)');
    expect(css).toContain('@media(max-width:1150px)');
    expect(css).toContain('@media(max-width:760px)');
    expect(css).toContain('@media(max-width:480px)');
    expect(css).toContain('html,body{font-size:15px!important');
  });
});
