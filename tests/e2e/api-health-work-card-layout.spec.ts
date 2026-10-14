import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// GitHub-hosted runners provide Google Chrome, not Playwright's bundled Chromium.
test.use({ channel: 'chrome' });

// Use the real CSS cascade: inline Health styles, shared Work UI,
// canonical Work Center visual CSS, then the final PC01 Health overrides.
const healthHtml = readFileSync('apps/tigeriq-core/dashboard.html', 'utf8');
const inlineStyles = [...healthHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]);
if (inlineStyles.length !== 5) throw new Error('API Health inline CSS order changed; re-audit the fixture');
const css = [
  ...inlineStyles.slice(0, 3),
  readFileSync('public/work-ui.css', 'utf8'),
  inlineStyles[3],
  readFileSync('public/work-center-visual.css', 'utf8'),
  inlineStyles[4],
].join('\n');

const title = 'Tích hợp bộ điều phối TigerIQ với bước rà soát tự động, nghiệm thu kết quả trên máy PC01 và kiểm tra trải nghiệm của chủ sở hữu ở nhiều độ phân giải, không được làm mất tên công việc khi dài';
const cards = Array.from({ length: 8 }, (_, i) => `
  <article class="work-row health-live-work-card tiq-work-card status-waiting">
    <div class="work-id">#${2293 + i}</div><div class="priority p2">P2</div>
    <div class="work-main">
      <div class="work-top"><span class="rank">${i + 1}</span><span class="work-nv">CHƯA XÁC MINH</span><span class="state waiting">CHỜ</span></div>
      <div class="work-hierarchy">Dự án TigerIQ / Giao diện</div>
      <div class="work-title">${i % 2 === 0 ? title : 'Kiểm tra khả năng hiển thị tiêu đề của thẻ công việc'}</div>
      <div class="work-quick"><span>Nhật ký công việc, trạng thái và bước tiếp theo phải nằm dưới tiêu đề.</span></div>
      <div class="work-progress-bottom"><div class="work-step-summary">3/12 bước đã xác minh</div><div class="progress"><div class="progress-track"><div class="progress-fill" style="width:25%"></div></div><span class="progress-text">25%</span></div></div>
    </div>
  </article>`).join('');

for (const viewport of [{width:1664,height:900},{width:390,height:844}]) {
  test(`Health card title follows content, no overlap at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.setContent(`<!doctype html><html lang="vi"><head><style>${css}</style></head><body class="api-health"><div class="app"><main><section class="panel work-panel"><div id="workList" class="wo-list work-list tiq-work-center" style="width:min(100%,1220px)">${cards}</div></section></main></div></body></html>`);
    const metrics = await page.locator('#workList > .tiq-work-card').evaluateAll((elements) => elements.map((card) => {
      const main = card.querySelector('.work-main') as HTMLElement;
      const heading = card.querySelector('.work-title') as HTMLElement;
      const below = card.querySelector('.work-quick') as HTMLElement;
      const outerBox = card.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      const titleBox = heading.getBoundingClientRect();
      const belowBox = below.getBoundingClientRect();
      return {
        top: outerBox.top, bottom: outerBox.bottom, mainBottom: mainBox.bottom,
        headingBottom: titleBox.bottom, belowTop: belowBox.top,
        display: getComputedStyle(heading).display,
        headingHeight: heading.clientHeight, headingScrollHeight: heading.scrollHeight
      };
    }));
    expect(metrics.length).toBe(8);
    for (const card of metrics) {
      expect(card.display).toBe('block');
      expect(card.headingScrollHeight).toBeLessThanOrEqual(card.headingHeight + 1);
      expect(card.mainBottom).toBeLessThanOrEqual(card.bottom + 2);
      expect(card.headingBottom).toBeLessThanOrEqual(card.belowTop + 1);
    }
    const tops = [...new Set(metrics.map((card) => Math.round(card.top)))].sort((a, b) => a - b);
    expect(tops.length).toBeGreaterThan(1);
    for (let i = 0; i < tops.length - 1; i++) {
      const firstRowBottom = Math.max(...metrics.filter((card) => Math.round(card.top) === tops[i]).map((card) => card.bottom));
      expect(firstRowBottom).toBeLessThanOrEqual(tops[i + 1] + 1);
    }
  });
}
