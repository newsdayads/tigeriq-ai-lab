import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyLayoutRepairV35, WEB_LOCAL_VERSION_V14 } from '../apps/dashboard/src/server-v14.js';

const sample = `<!doctype html><html><head></head><body><div class="shell"><aside class="sidebar"><nav>one</nav></aside><main class="content"><section id="tigeriq-management-v31" data-version="WEB-LOCAL-396-V3.4" data-theme="fluent-executive-v34"><div class="tq31-section tq34-team-section"></div><div class="tq31-section tq34-system-section"><div class="tq31-systems"><article class="tq-system"><span class="tq34-system-icon"></span><div><b>TIGERIQ CONTROL PLANE</b><span class="tq-badge bad">SUY GIẢM / BỊ LỖI</span><small>Controller cổng 8790 không phản hồi và mô tả kỹ thuật dài</small></div></article></div></div><div class="tq31-section tq34-owner-section"></div><div class="tq31-section tq34-rights-section"></div></section></main></div><aside class="sidebar"><nav>duplicate</nav></aside></body></html>`;

describe('Web Local #396 UI V3.5 machine-real layout repair', () => {
  it('dedupes sidebar and marks repaired runtime', () => {
    const html = applyLayoutRepairV35(sample);
    expect(html).toContain(WEB_LOCAL_VERSION_V14);
    expect(html).toContain('data-theme="fluent-executive-v35"');
    expect(html).toContain('data-layout="v35-repaired"');
    expect((html.match(/<aside class="sidebar">/g) ?? []).length).toBe(1);
    expect(html).not.toContain('duplicate');
  });

  it('repairs lower grid placement and prevents vertical system text collapse', () => {
    const html = applyLayoutRepairV35(sample);
    for (const expected of [
      '.tq34-team-section{grid-column:1/-1!important}',
      '.tq34-system-section{grid-column:1!important}',
      '.tq34-owner-section{grid-column:2!important}',
      '.tq34-rights-section{grid-column:1/-1!important}',
      'grid-template-columns:repeat(3,minmax(0,1fr))!important',
      'word-break:normal!important',
      'overflow-wrap:break-word!important',
      '.tq31-systems .tq-system small{display:none!important}',
      'grid-auto-rows:max-content!important',
    ]) expect(html).toContain(expected);
  });

  it('retains V3.5 repair as provenance while V3.6 is the current final runtime', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    for (const expected of [
      'WEB-LOCAL-396-V3.6', 'startOwnerCockpitV14', 'startOwnerCockpitV15', 'layout_repair_v35=ĐẠT',
      'sidebar_single_dom=ĐẠT', 'system_card_compaction=ĐẠT', 'system_text_wrap_contract=ĐẠT',
      'bottom_grid_gap_repair=ĐẠT', 'state=WEB_LOCAL_396_V36_INCREMENTAL_LIVE_VERIFIED',
    ]) expect(standalone).toContain(expected);
    expect(standalone).toContain('startOwnerCockpitV13');
  });
});
