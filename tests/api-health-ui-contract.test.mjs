import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('#3918 API Health shared Work UI contract',()=>{
  const dashboard=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const live=readFileSync(new URL('../command-center.html',import.meta.url),'utf8');
  const livePublic=readFileSync(new URL('../public/command-center.html',import.meta.url),'utf8');
  const shared=readFileSync(new URL('../public/work-ui.css',import.meta.url),'utf8');

  it('uses one shared Work UI stylesheet on Live and API Health',()=>{
    expect(dashboard).toContain('href="/work-ui.css"');
    expect(live).toContain('href="/work-ui.css"');
    expect(livePublic).toContain('href="/work-ui.css"');
    expect(shared).toContain('.work-row,.wo-card');
    expect(shared).toContain('.work-title,.wo-title');
    expect(shared).toContain('.work-summary,.wo-current');
    expect(core).toContain("url.pathname==='/work-ui.css'");
    expect(core).toContain("../../public/work-ui.css");
  });

  it('keeps API Health compact with two workforce rows and no dead top navigation',()=>{
    expect(dashboard).toContain('<body class="api-health">');
    expect(shared).toContain('.api-health .nav{display:none!important}');
    expect(shared).toContain('--employee-row-h:132px');
    expect(shared).toContain('max-height:calc(var(--employee-row-h) * 2 + var(--employee-gap) + 20px)');
    expect(shared).toContain('overflow-y:auto!important');
    expect(shared).toContain('.api-health .wo-list,.api-health .work-list{display:grid;gap:10px;grid-template-columns:repeat(2,minmax(0,1fr))');
    expect(dashboard).toContain('id="workList" class="wo-list work-list"');
    expect(dashboard).toContain('class="work-row status-');
    expect(dashboard).toContain('class="work-top"');
    expect(dashboard).toContain('class="work-title"');
    expect(dashboard).toContain('class="work-facts"');
    expect(dashboard).not.toContain('.wo-card{');
    expect(dashboard).not.toContain('class="wo-card');
  });

  it('orders side panels performance then recent activity then alerts and uppercases headings',()=>{
    const perf=dashboard.indexOf('HIỆU SUẤT API 24 GIỜ');
    const activity=dashboard.indexOf('HOẠT ĐỘNG GẦN ĐÂY');
    const alerts=dashboard.indexOf('CẢNH BÁO HIỆN TẠI');
    expect(perf).toBeGreaterThan(-1);
    expect(activity).toBeGreaterThan(perf);
    expect(alerts).toBeGreaterThan(activity);
    expect(dashboard).toContain('TOÀN BỘ NHÂN SỰ / TÀI NGUYÊN AI');
    expect(dashboard).toContain('DANH SÁCH CÔNG VIỆC');
  });

  it('adds live motion without forcing animation for reduced-motion users',()=>{
    expect(shared).toContain('@keyframes tiq-work-live');
    expect(shared).toContain('@keyframes tiq-event-in');
    expect(shared).toContain('@media(prefers-reduced-motion:reduce)');
    expect(dashboard).toContain("let lastActivitySignature=''");
    expect(dashboard).toContain("classList.add('recent-activity')");
    expect(dashboard).toContain('class="sync-status"');
  });
});
