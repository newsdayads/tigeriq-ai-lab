import { describe, expect, it } from 'vitest';
import { applyOverviewV32 } from '../apps/dashboard/src/server-v11.js';
import { isFunctionalRequest, markFunctionalSurface, rewriteFunctionalLocation } from '../apps/dashboard/src/server-v15.js';

const base = `<!doctype html><html lang="vi"><head></head><body><div class="shell"><aside class="sidebar"><nav class="nav"><a href="#tong-quan">Tổng quan</a><a href="#cong-viec">Công việc</a><a href="#doi-ai">Đội AI</a><a href="#mo-hinh">Mô hình AI</a><a href="#bang-chung">Bằng chứng</a><a href="#bao-cao">Báo cáo</a><a href="#he-thong">Hệ thống</a><a href="#cai-dat">Cài đặt</a></nav></aside><main class="content"><header class="top"><h1>Xin chào anh Sơn</h1><p>Đây là tình hình TigerIQ hiện tại.</p><form class="search" method="get"><input name="q"></form></header><form class="login" method="post" action="/login"><button>Đăng nhập</button></form><form class="assign" method="post" action="/jobs"><button>Giao việc</button></form><section class="kpis"><article>KPI cũ</article></section><section id="tigeriq-management-v31" data-version="WEB-LOCAL-396-V3.1"><div>Dashboard mới</div></section><section class="grid-main" id="cong-viec"><div>Công việc cũ</div><form class="work-action" method="post"></form></section><section class="panel detail" id="chi-tiet"><div>Chi tiết công việc</div></section><section class="panel" id="doi-ai"><div>Đội AI cũ</div></section><section class="panel" id="mo-hinh"><div>Mô hình AI cũ</div></section><section class="panel" id="bang-chung"><div>Bằng chứng cũ</div></section><section class="panel" id="bao-cao"><div>Báo cáo cũ</div></section><section class="panel" id="he-thong"><div>Hệ thống cũ</div><form class="system-actions" method="post" action="/system-action"><button>Kiểm tra PC01</button></form></section><section class="panel" id="cai-dat"><div>Cài đặt cũ</div></section></main></div></body></html>`;

const expected: Record<string, string[]> = {
  work: ['id="cong-viec"', 'id="chi-tiet"', 'class="assign"', 'class="login"'],
  workforce: ['id="doi-ai"'],
  models: ['id="mo-hinh"'],
  evidence: ['id="bang-chung"', 'id="chi-tiet"'],
  reports: ['id="bao-cao"'],
  system: ['id="he-thong"', 'class="system-actions"'],
  settings: ['id="cai-dat"'],
};

const forbiddenByView: Record<string, string[]> = {
  work: ['id="doi-ai"', 'id="mo-hinh"', 'id="bang-chung"', 'id="bao-cao"', 'id="he-thong"', 'id="cai-dat"'],
  workforce: ['id="cong-viec"', 'id="mo-hinh"', 'id="bang-chung"', 'id="bao-cao"', 'id="he-thong"', 'id="cai-dat"'],
  models: ['id="cong-viec"', 'id="doi-ai"', 'id="bang-chung"', 'id="bao-cao"', 'id="he-thong"', 'id="cai-dat"'],
  evidence: ['id="cong-viec"', 'id="doi-ai"', 'id="mo-hinh"', 'id="bao-cao"', 'id="he-thong"', 'id="cai-dat"'],
  reports: ['id="cong-viec"', 'id="doi-ai"', 'id="mo-hinh"', 'id="bang-chung"', 'id="he-thong"', 'id="cai-dat"'],
  system: ['id="cong-viec"', 'id="doi-ai"', 'id="mo-hinh"', 'id="bang-chung"', 'id="bao-cao"', 'id="cai-dat"'],
  settings: ['id="cong-viec"', 'id="doi-ai"', 'id="mo-hinh"', 'id="bang-chung"', 'id="bao-cao"', 'id="he-thong"'],
};

describe('Web Local #396 functional-surface isolation guard', () => {
  it('keeps all seven dedicated functional views intact at the V11 router', () => {
    for (const [view, markers] of Object.entries(expected)) {
      const html = applyOverviewV32(base, view as Parameters<typeof applyOverviewV32>[1]);
      for (const marker of markers) expect(html, `${view} missing ${marker}`).toContain(marker);
      for (const marker of forbiddenByView[view]) expect(html, `${view} leaked ${marker}`).not.toContain(marker);
      expect(html).not.toContain('Dashboard mới');
      expect(html).toContain(`class="on" href="/?view=${view}"`);
    }
  });

  it('keeps overview presentation separate from legacy functional sections', () => {
    const html = applyOverviewV32(base, 'overview');
    expect(html).toContain('Dashboard mới');
    for (const marker of ['id="cong-viec"', 'id="doi-ai"', 'id="mo-hinh"', 'id="bang-chung"', 'id="bao-cao"', 'id="he-thong"', 'id="cai-dat"', 'class="assign"', 'class="login"']) expect(html).not.toContain(marker);
  });

  it('routes only functional views and all write requests through the stable V12 surface', () => {
    for (const view of Object.keys(expected)) expect(isFunctionalRequest('GET', `/?view=${view}`)).toBe(true);
    expect(isFunctionalRequest('GET', '/?view=overview')).toBe(false);
    expect(isFunctionalRequest('GET', '/')).toBe(false);
    expect(isFunctionalRequest('GET', '/api/status')).toBe(false);
    expect(isFunctionalRequest('POST', '/jobs')).toBe(true);
    expect(isFunctionalRequest('POST', '/decision')).toBe(true);
    expect(isFunctionalRequest('POST', '/system-action')).toBe(true);
  });

  it('marks the stable functional surface without applying dashboard CSS/DOM transforms', () => {
    const stable = '<html lang="vi"><head></head><body><form class="assign"><button>Giao việc</button></form><section id="cong-viec">Công việc</section></body></html>';
    const html = markFunctionalSurface(stable);
    expect(html).toContain('data-functional-surface="stable-v12-isolated"');
    expect(html).toContain('class="assign"');
    expect(html).toContain('id="cong-viec"');
    expect(html).not.toContain('tq34-fluent-executive');
    expect(html).not.toContain('tq35-layout-repair');
    expect(html).not.toContain('tq36-live-overview');
  });

  it('keeps action redirects inside their functional tab', () => {
    expect(rewriteFunctionalLocation('/?notice=ok&work=WO-1#chi-tiet')).toBe('/?notice=ok&work=WO-1&view=work#chi-tiet');
    expect(rewriteFunctionalLocation('/?notice=ok#he-thong')).toBe('/?notice=ok&view=system#he-thong');
    expect(rewriteFunctionalLocation('/#cong-viec')).toBe('/?view=work#cong-viec');
    expect(rewriteFunctionalLocation('/?view=system#he-thong')).toBe('/?view=system#he-thong');
  });
});
