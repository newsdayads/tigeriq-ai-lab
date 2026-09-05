import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transformManagementUiV31, WEB_LOCAL_VERSION_V9 } from '../apps/dashboard/src/server-v9.js';

const sample = `<!doctype html><html><head><title>TigerIQ</title></head><body><header>Header</header><section class="tq322" id="tigeriq-management-v4"><div class="tq-section"><div class="tq-cell"><span>CÔNG VIỆC HIỆN HÀNH</span><b>#306 · Auto Worker V13.4.6</b></div><div class="tq-cell"><span>TIẾN ĐỘ</span><b>Đang xử lý</b></div><div class="tq-cell"><span>TRẠNG THÁI</span><b><span class="tq-badge run">ĐANG XỬ LÝ</span></b></div><div class="tq-cell"><span>NGƯỜI PHỤ TRÁCH</span><b>Khoa (NV02 — Vận hành tự động)</b></div></div><div class="tq-section"><table><tbody><tr><td data-label="Mốc kế tiếp">Kiểm thử Chrome thật</td><td data-label="Cập nhật cuối">05/09/2026 10:00:00</td></tr></tbody></table><div class="tq-cell"><span>BƯỚC HIỆN TẠI</span><b>Đang chờ kiểm thử máy thật</b></div></div><div class="tq-section"><h3>🔐 QUYỀN XỬ LÝ / CHUYỂN GIAO</h3><div class="tq-cell"><span class="tq-badge neutral">KHÔNG CÓ SỰ KIỆN MỚI</span><b>Không tự suy diễn</b></div></div><div class="tq-section"><h3>🔴 CẦN ANH SƠN</h3><div class="tq-owner ok">Không có việc nào đang cần anh Sơn duyệt hoặc thao tác thật.</div></div><div class="tq-section"><h3>👥 NHÂN SỰ AI</h3><div class="tq-people"><article class="tq-person"><div><b>Vy (Trợ lý)</b><small>Điều phối</small></div><span class="tq-badge neutral">ĐIỀU PHỐI</span></article><article class="tq-person"><div><b>Minh (NV01 — Thực thi trực tiếp)</b><small>Lệnh 1</small></div><span class="tq-badge neutral">CHỜ VIỆC</span></article><article class="tq-person"><div><b>Khoa (NV02 — Vận hành tự động)</b><small>Lệnh 2</small></div><span class="tq-badge run">ĐANG XỬ LÝ #306</span></article><article class="tq-person"><div><b>Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)</b><small>Lệnh 3</small></div><span class="tq-badge neutral">TẠM NGƯNG</span></article><article class="tq-person"><div><b>Khải (NV04 — Kỹ sư Tích hợp AI/API)</b><small>Lệnh 4</small></div><span class="tq-badge neutral">CHỜ VIỆC</span></article></div></div><div class="tq-section"><h3>🖥️ TÌNH TRẠNG HỆ THỐNG</h3><div class="tq-systems"><article class="tq-system"><div><b>PC01 SERVER</b><span class="tq-badge ok">TRỰC TUYẾN</span></div></article><article class="tq-system"><div><b>TIGERIQ CONTROL PLANE</b><span class="tq-badge bad">SUY GIẢM / BỊ LỖI</span></div></article><article class="tq-system"><div><b>AI PC01</b><span class="tq-badge neutral">TẠM NGƯNG</span></div></article></div></div><div class="tq-section"><details class="tq-tech"><summary>Bằng chứng kỹ thuật</summary><p>build abc123</p></details></div></section></body></html>`;

describe('Web Local #396 UI V3.1', () => {
  it('replaces V4 management panel with compact five-KPI layout and Inter', () => {
    const html = transformManagementUiV31(sample);
    for (const expected of [
      'tigeriq-management-v31', WEB_LOCAL_VERSION_V9, 'fonts.googleapis.com/css2?family=Inter',
      'Đang làm', 'Ai phụ trách', 'Tiến độ', 'Vướng mắc', 'Cần anh Sơn', 'Công việc đang chạy',
      'Vy (Trợ lý)', 'Minh (NV01 — Thực thi trực tiếp)', 'Khoa (NV02 — Vận hành tự động)',
      'Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)', 'Khải (NV04 — Kỹ sư Tích hợp AI/API)',
    ]) expect(html).toContain(expected);
    expect(html).not.toContain('id="tigeriq-management-v4"');
  });

  it('renders three real-data visual surfaces without fabricated workload numbers', () => {
    const html = transformManagementUiV31(sample);
    expect(html).toContain('Phân bố công việc');
    expect(html).toContain('Tải theo nhân sự');
    expect(html).toContain('Trạng thái hệ thống');
    expect(html).toContain('1 việc đang xử lý');
    expect(html).toContain('0 việc đang xử lý');
    expect(html).toContain('<b>1</b> ổn định');
    expect(html).toContain('<b>1</b> cảnh báo');
  });

  it('uses one SVG icon system and removes management-heading emoji dependency', () => {
    const html = transformManagementUiV31(sample);
    expect(html).toContain('class="tq31-icon"');
    expect(html).not.toContain('🐯');
    expect(html).not.toContain('📊');
    expect(html).not.toContain('👥');
    expect(html).not.toContain('🖥️');
  });

  it('has responsive CSS plus complete button interaction states', () => {
    const html = transformManagementUiV31(sample);
    for (const expected of ['box-sizing:border-box', ':hover', ':active', ':focus-visible', ':disabled', 'transition:', '@media(max-width:1100px)', '@media(max-width:760px)', '@media(max-width:500px)']) expect(html).toContain(expected);
  });

  it('targets machine-real evidence at issue #396 with UI V3.1 acceptance markers', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    for (const expected of [
      'WEB-LOCAL-396-V3.1', 'issues/396/comments?per_page=100', 'issues/396/comments',
      'inter_font_contract=ĐẠT', 'button_interaction_states=ĐẠT', 'management_layout_v31=ĐẠT',
      'visualizations_real_data=3', 'responsive_css_contract=ĐẠT',
      'state=WEB_LOCAL_396_V31_RUNTIME_AND_UI_VERIFIED', 'startOwnerCockpitV9',
    ]) expect(standalone).toContain(expected);
  });
});
