import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyOverviewV32, WEB_LOCAL_VERSION_V11 } from '../apps/dashboard/src/server-v11.js';

const base = `<!doctype html><html><head><style>:root{font-family:"Segoe UI Variable","Segoe UI",Arial,sans-serif;}</style></head><body><div class="shell"><aside><nav class="nav"><a href="#tong-quan">Tổng quan</a><a href="#cong-viec">Công việc</a><a href="#doi-ai">Đội AI</a><a href="#mo-hinh">Mô hình AI</a><a href="#bang-chung">Bằng chứng</a><a href="#bao-cao">Báo cáo</a><a href="#he-thong">Hệ thống</a><a href="#cai-dat">Cài đặt</a></nav></aside><main class="content"><header class="top"><h1>Xin chào anh Sơn</h1><p>Đây là tình hình TigerIQ hiện tại.</p><form class="search" method="get"><input name="q"></form></header><form class="assign" method="post"><button>Giao việc</button></form><section class="kpis"><article>KPI cũ</article></section><section id="tigeriq-management-v31" data-version="WEB-LOCAL-396-V3.1"><div>Dashboard mới</div></section><section class="grid-main" id="cong-viec"><div>Công việc cũ</div></section><section class="panel detail" id="chi-tiet"><div>Chi tiết</div></section><section class="panel" id="doi-ai"><div>AI cũ</div></section><section class="panel" id="mo-hinh"><div>Model cũ</div></section><section class="panel" id="bang-chung"><div>Bằng chứng cũ</div></section><section class="panel" id="bao-cao"><div>Báo cáo cũ</div></section><section class="panel" id="he-thong"><div>Hệ thống cũ</div></section><section class="panel" id="cai-dat"><div>Cài đặt cũ</div></section></main></div></body></html>`;

describe('Web Local #396 UI V3.2', () => {
  it('keeps exactly one dashboard on Tổng quan and physically removes legacy duplicate sections', () => {
    const html = applyOverviewV32(base, 'overview');
    expect(html).toContain(WEB_LOCAL_VERSION_V11);
    expect(html).toContain('data-overview="single-dashboard-v32"');
    expect(html).toContain('Dashboard mới');
    expect(html).not.toContain('KPI cũ');
    expect(html).not.toContain('Giao việc');
    for (const id of ['cong-viec', 'chi-tiet', 'doi-ai', 'mo-hinh', 'bang-chung', 'bao-cao', 'he-thong', 'cai-dat']) expect(html).not.toContain(`id="${id}"`);
  });

  it('routes legacy functions to dedicated server-side views instead of duplicating them on Tổng quan', () => {
    const work = applyOverviewV32(base, 'work');
    expect(work).not.toContain('Dashboard mới');
    expect(work).toContain('id="cong-viec"');
    expect(work).toContain('id="chi-tiet"');
    expect(work).toContain('Giao việc');
    expect(work).not.toContain('id="doi-ai"');
    expect(work).toContain('class="on" href="/?view=work"');

    const system = applyOverviewV32(base, 'system');
    expect(system).toContain('id="he-thong"');
    expect(system).not.toContain('id="cong-viec"');
    expect(system).not.toContain('Dashboard mới');
    expect(system).toContain('class="on" href="/?view=system"');
  });

  it('retains historical V3.2 Open Sans layer before final wrappers', () => {
    const html = applyOverviewV32(base, 'workforce');
    expect(html).toContain(':root{font-family:"Open Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;');
    expect(html).toContain('<input type="hidden" name="view" value="workforce">');
  });

  it('retains V3.2 single-overview semantics under V3.4 Fluent Executive', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    for (const expected of [
      'WEB-LOCAL-396-V3.4', 'startOwnerCockpitV11', 'startOwnerCockpitV13', 'overview_single_dashboard=ĐẠT',
      'legacy_overview_duplicate_removed=ĐẠT', 'server_side_views=8', 'segoe_ui_whole_site=ĐẠT',
      'fluent_executive_visual_contract=ĐẠT', 'state=WEB_LOCAL_396_V34_FLUENT_EXECUTIVE_VERIFIED',
      'data-overview="single-dashboard-v32"',
    ]) expect(standalone).toContain(expected);
    expect(standalone).not.toContain('open_sans_whole_site=ĐẠT');
  });
});