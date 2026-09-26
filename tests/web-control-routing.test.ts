import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const routing=readFileSync('apps/tigeriq-core/web-control-routing.js','utf8');
const css=readFileSync('apps/tigeriq-core/web-control-routing.css','utf8');
const server=readFileSync('apps/tigeriq-core/web-control-server.mjs','utf8');
const workforce=readFileSync('apps/tigeriq-core/web-control-workforce.js','utf8');

describe('#777 Web Control Smart Router projection',()=>{
  it('layers routing after canonical workforce instead of replacing it',()=>{
    expect(server).toContain('<script src="/web-control-workforce.js"></script><script src="/web-control-routing.js"></script>');
    expect(server).toContain('/web-control-routing.css');
    expect(routing).toContain('window.__tigerIqRoutingProjection');
    expect(routing).not.toContain('renderWorkers =');
    expect(workforce).toContain('window.renderWorkers = renderWorkforceCards');
  });

  it('separates AI resources from employees and exposes stable resource identity/quota',()=>{
    expect(routing).toContain('Tài nguyên AI');
    expect(routing).toContain('tqUResources');
    expect(routing).toContain('r.resource_id');
    expect(routing).toContain('resource?.quota_state');
    expect(routing).toContain('Resource identity riêng');
  });

  it('shows routing decisions, task performance and failover truth from Core',()=>{
    expect(routing).toContain('Định tuyến AI');
    expect(routing).toContain('Hiệu suất theo loại việc');
    expect(routing).toContain('routingDecisions');
    expect(routing).toContain('performanceByTask');
    expect(routing).toContain('ROUTING_FAILOVER');
    expect(routing).toContain('chosen.reasons');
  });

  it('uses truthful empty states and responsive layouts',()=>{
    expect(routing).toContain('Chưa có quyết định định tuyến thật từ Core.');
    expect(routing).toContain('Chưa có dữ liệu hiệu suất thật theo loại việc.');
    expect(routing).toContain('Chưa có dữ liệu');
    expect(css).toContain('@media(max-width:1500px)');
    expect(css).toContain('@media(max-width:1150px)');
    expect(css).toContain('@media(max-width:760px)');
    expect(css).toContain('@media(max-width:480px)');
  });
});
