import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyLiveOverviewV36, WEB_LOCAL_VERSION_V15 } from '../apps/dashboard/src/server-v15.js';

const sample = `<!doctype html><html><head><meta http-equiv="refresh" content="30"></head><body><div class="shell"><aside class="sidebar"><a class="brand"><div class="mark"><svg class="ico"></svg></div><div><b><span>TigerIQ</span> AI Lab</b><small>Bảng điều hành</small></div></a></aside><main class="content"><header class="top"><div><h1>Xin chào anh Sơn</h1><p>Đây là tình hình TigerIQ hiện tại.</p></div><form class="search"><input></form></header><section id="tigeriq-management-v31" data-version="WEB-LOCAL-396-V3.5" data-theme="fluent-executive-v35" data-layout="v35-repaired" data-overview="single-dashboard-v32"><div class="tq31-kpis"><article class="tq31-kpi">Đang làm</article></div><div class="tq31-grid"><article class="tq31-card"><h3>Công việc đang chạy</h3><table class="tq31-table"><tbody><tr><td>#396</td></tr></tbody></table></article><div class="tq31-chart-stack"><article class="tq31-card">Phân bố công việc</article></div></div><div class="tq31-section tq34-team-section"><article class="tq31-card"><div class="tq31-people"><article class="tq-person"><div class="tq34-avatar blue">VY</div></article></div></article></div><div class="tq31-section tq34-system-section"><article class="tq31-card">Hệ thống</article></div><div class="tq31-section tq34-owner-section"><article class="tq31-card">Cần anh Sơn</article></div><div class="tq31-section tq34-rights-section"><article class="tq31-card">Quyền xử lý / chuyển giao</article></div></section></main></div></body></html>`;

describe('Web Local #396 UI V3.6 incremental live overview', () => {
  it('removes full-page meta refresh and marks the incremental 10-second contract', () => {
    const html = applyLiveOverviewV36(sample);
    expect(html).toContain(WEB_LOCAL_VERSION_V15);
    expect(html).toContain('data-theme="fluent-executive-v36"');
    expect(html).toContain('data-refresh="incremental-10s"');
    expect(html).not.toMatch(/http-equiv=["']refresh["']/i);
    expect(html).toContain('Live · 10 giây');
    expect(html).toContain('id="tq36-refresh"');
    expect(html).toContain('setInterval(update,INTERVAL)');
    expect(html).toContain("fetch(location.href,{cache:'no-store'");
  });

  it('replaces the broken brand mark and hardens avatar alignment', () => {
    const html = applyLiveOverviewV36(sample);
    expect(html).toContain('class="mark tq36-brand-mark"');
    expect(html).toContain('class="tq36-brand-svg"');
    expect(html).toContain('.tq34-avatar{position:relative!important;display:flex!important;align-items:center!important;justify-content:center!important;');
  });

  it('creates independent left/right dashboard columns so work-table height is not stretched by charts', () => {
    const html = applyLiveOverviewV36(sample);
    expect(html).toContain('.tq36-columns{display:grid;grid-template-columns:minmax(0,2.15fr) minmax(330px,.9fr);');
    expect(html).toContain("left.className='tq36-left'");
    expect(html).toContain("right.className='tq36-right'");
    expect(html).toContain('left.append(work)');
    expect(html).toContain('right.append(charts)');
    expect(html).toContain('.tq36-left>.tq31-card{height:auto!important;min-height:0!important;');
  });

  it('updates only changed overview sections and visibly flashes those sections', () => {
    const html = applyLiveOverviewV36(sample);
    for (const expected of ['function sync(cur,next)', "a.innerHTML=b.innerHTML", "a.classList.add('tq36-flash','tq36-updated')", 'tq36-live-age', 'visibilitychange']) expect(html).toContain(expected);
  });

  it('wires final runtime evidence to V3.6 while preserving V3.5 underneath', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    for (const expected of [
      'WEB-LOCAL-396-V3.6', 'startOwnerCockpitV15', 'incremental_refresh=ĐẠT',
      'incremental_refresh_interval_seconds=10', 'full_page_meta_refresh_removed=ĐẠT',
      'changed_section_flash=ĐẠT', 'manual_refresh_button=ĐẠT', 'live_age_indicator=ĐẠT',
      'independent_dashboard_columns=ĐẠT', 'work_table_gap_removed=ĐẠT',
      'brand_icon_polish=ĐẠT', 'team_avatar_alignment=ĐẠT',
      'state=WEB_LOCAL_396_V36_INCREMENTAL_LIVE_VERIFIED',
    ]) expect(standalone).toContain(expected);
    expect(standalone).toContain('startOwnerCockpitV14');
  });
});
