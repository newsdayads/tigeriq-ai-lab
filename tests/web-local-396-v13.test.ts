import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyFluentExecutiveV34, WEB_LOCAL_VERSION_V13 } from '../apps/dashboard/src/server-v13.js';

const sample = `<!doctype html><html><head></head><body><div class="shell"><aside class="sidebar"><a class="brand"><div class="mark"></div><div><b>TigerIQ AI Lab</b><small>Bảng điều hành</small></div></a><nav class="nav"><a class="on">Tổng quan</a></nav></aside><main class="content"><header class="top"><div><h1>Xin chào anh Sơn</h1><p>Đây là tình hình TigerIQ hiện tại.</p></div><form class="search"><input></form></header><section id="tigeriq-management-v31" data-version="WEB-LOCAL-396-V3.3" data-font="segoe-ui-default" data-overview="single-dashboard-v32"><div class="tq31-top"></div><div class="tq31-kpis"><article class="tq31-kpi"><div class="tq31-kpi-head"><svg class="tq31-icon"></svg><span>Đang làm</span></div><b class="tq31-kpi-value">#396</b></article><article class="tq31-kpi"><div class="tq31-kpi-head"><svg class="tq31-icon"></svg><span>Ai phụ trách</span></div><b class="tq31-kpi-value">Minh (NV01 — Thực thi trực tiếp)</b></article><article class="tq31-kpi"><div class="tq31-kpi-head"><svg class="tq31-icon"></svg><span>Tiến độ</span></div><b class="tq31-kpi-value">Đang xử lý</b></article><article class="tq31-kpi"><div class="tq31-kpi-head"><svg class="tq31-icon"></svg><span>Vướng mắc</span></div><b class="tq31-kpi-value">Không có</b></article><article class="tq31-kpi"><div class="tq31-kpi-head"><svg class="tq31-icon"></svg><span>Cần anh Sơn</span></div><div class="tq31-kpi-value tq31-owner-action"><div class="tq-owner ok">Không có việc cần anh Sơn</div></div></article></div><div class="tq31-grid"><article class="tq31-card"><h3>Công việc đang chạy</h3><table class="tq31-table"><thead><tr><th>Công việc</th></tr></thead><tbody><tr><td>#396</td></tr></tbody></table></article><div class="tq31-chart-stack"><article class="tq31-card"><h3>Phân bố công việc</h3><div class="tq31-segments"><span class="active" style="width:40%"></span><span class="waiting" style="width:20%"></span><span class="complete" style="width:20%"></span><span class="paused" style="width:20%"></span></div><div class="tq31-legend"><span><b>2</b> đang xử lý</span><span><b>1</b> đang chờ</span><span><b>1</b> hoàn tất</span><span><b>1</b> tạm ngưng</span></div></article><article class="tq31-card"><h3>Tải theo nhân sự</h3><div class="tq31-bar-row"><div class="tq31-bar-label"><span>Minh</span><b>1 việc</b></div><div class="tq31-bar-track"><i style="width:100%"></i></div></div></article><article class="tq31-card"><h3>Trạng thái hệ thống</h3><div class="tq31-system-visual"><span class="good"><b>2</b> ổn định</span><span class="warn"><b>0</b> cảnh báo</span><span class="neutral"><b>1</b> tạm ngưng</span></div></article></div></div><div class="tq31-section"><article class="tq31-card"><h3>Đội AI</h3><div class="tq31-people"><article class="tq-person"><div><b>Vy (Trợ lý)</b><small>Điều phối</small></div><span class="tq-badge">ĐANG XỬ LÝ</span></article><article class="tq-person"><div><b>Minh (NV01 — Thực thi trực tiếp)</b><small>Thực thi</small></div><span class="tq-badge">ĐANG XỬ LÝ</span></article><article class="tq-person"><div><b>Khoa (NV02 — Vận hành tự động)</b><small>Vận hành</small></div><span class="tq-badge">ĐANG XỬ LÝ</span></article><article class="tq-person"><div><b>Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)</b><small>Local</small></div><span class="tq-badge">TẠM NGƯNG</span></article><article class="tq-person"><div><b>Khải (NV04 — Kỹ sư Tích hợp AI/API)</b><small>API</small></div><span class="tq-badge">ĐANG XỬ LÝ</span></article></div></article></div><div class="tq31-section"><article class="tq31-card"><h3>Hệ thống</h3><div class="tq31-systems"><article class="tq-system"><div><b>PC01 Server</b><small>TRỰC TUYẾN</small></div></article><article class="tq-system"><div><b>Control Plane</b><small>SẴN SÀNG</small></div></article></div></article></div><div class="tq31-section"><article class="tq31-card tq31-owner-event"><h3>Quyền xử lý / chuyển giao</h3><div>Không có sự kiện mới</div></article></div></section></main></div></body></html>`;

describe('Web Local #396 Fluent Executive V3.4', () => {
  it('applies the approved executive visual layer without external fonts', () => {
    const html = applyFluentExecutiveV34(sample);
    expect(html).toContain(WEB_LOCAL_VERSION_V13);
    expect(html).toContain('data-theme="fluent-executive-v34"');
    expect(html).toContain('data-visual-spec="fluent-executive-mockup"');
    expect(html).toContain('font-family:"Segoe UI",Arial,sans-serif');
    expect(html).toContain('font-size:15px');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('font-family:"Open Sans"');
    expect(html).not.toContain('font-family:Inter');
  });

  it('turns the distribution bar into a donut while preserving real counts', () => {
    const html = applyFluentExecutiveV34(sample);
    expect(html).toContain('class="tq34-donut"');
    expect(html).toContain('<b>5</b><small>công việc</small>');
    expect(html).toContain('var(--fx-green) 0 40%');
    expect(html).toContain('<b>2</b> đang xử lý');
    expect(html).toContain('<b>1</b> tạm ngưng');
  });

  it('adds five colorful AI avatar cards and system icons without changing canonical names', () => {
    const html = applyFluentExecutiveV34(sample);
    for (const expected of ['>VY</div>', '>MI</div>', '>KH</div>', '>HU</div>', '>K</div>', 'tq34-system-icon']) expect(html).toContain(expected);
    for (const name of ['Vy (Trợ lý)', 'Minh (NV01 — Thực thi trực tiếp)', 'Khoa (NV02 — Vận hành tự động)', 'Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)', 'Khải (NV04 — Kỹ sư Tích hợp AI/API)']) expect(html).toContain(name);
  });

  it('adds a highlighted owner card, stronger hierarchy and responsive layout', () => {
    const html = applyFluentExecutiveV34(sample);
    for (const expected of ['tq34-owner-highlight good', 'Không có việc cần anh Sơn', 'Mọi thứ đang trong tầm kiểm soát.', 'grid-template-columns:repeat(5,minmax(0,1fr))', '@media(max-width:1350px)', '@media(max-width:980px)', '@media(max-width:760px)', '@media(max-width:500px)', 'linear-gradient(135deg,#0755b0,#0a83e8)', 'linear-gradient(135deg,#3e20a8,#6f32e7)', 'linear-gradient(135deg,#087b6d,#08a77e)']) expect(html).toContain(expected);
  });

  it('retains V3.4 as historical provenance but removes it from the final V4 runtime chain', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    const v13 = readFileSync(new URL('../apps/dashboard/src/server-v13.ts', import.meta.url), 'utf8');
    for (const expected of ['WEB-LOCAL-396-V3.4', 'fluent-executive-v34', 'data-visual-spec="fluent-executive-mockup"']) expect(v13).toContain(expected);
    for (const expected of ['WEB-LOCAL-396-V4.0', 'startOwnerCockpitV17', 'reference_layout=APPROVED_1648x928_EXECUTIVE_SCREENSHOT', 'legacy_presentation_runtime_v13_v14_v15=REMOVED']) expect(standalone).toContain(expected);
    for (const retired of ['startOwnerCockpitV13', 'startOwnerCockpitV14', 'startOwnerCockpitV15']) expect(standalone).not.toContain(retired);
  });
});
