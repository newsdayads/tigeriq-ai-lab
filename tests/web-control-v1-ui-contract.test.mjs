import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Company Control Tower UI contract', () => {
  it('prioritizes the Operating Model V2 owner home view', async () => {
    const html = await read('public/web-v1/index.html');
    for (const label of ['MỤC TIÊU QUAN TRỌNG NHẤT','KẾT QUẢ KINH DOANH','MISSION ĐANG CHẠY','Phòng ban & AI Employee','CẦN SẾP','KẾT QUẢ VỪA HOÀN TẤT','SỨC KHỎE QUY TRÌNH','TÓM TẮT RUNTIME']) {
      expect(html).toContain(label);
    }
    const order = ['MỤC TIÊU QUAN TRỌNG NHẤT','KẾT QUẢ KINH DOANH','MISSION ĐANG CHẠY','CẦN SẾP','KẾT QUẢ VỪA HOÀN TẤT','SỨC KHỎE QUY TRÌNH'];
    const indexes = order.map(label => html.indexOf(label));
    expect(indexes.every(index => index >= 0)).toBe(true);
    expect(html).toContain('Company Control Tower');
    expect(html).toContain('<span>Sếp</span>');
    expect(html).not.toContain('Nhập tin nhắn');
    expect(html).not.toContain('Chat với TigerIQ');
  });

  it('moves deep technical drill-down to Technical Operations', async () => {
    const html = await read('public/web-v1/index.html');
    const technicalStart = html.indexOf('data-section="technical"');
    expect(technicalStart).toBeGreaterThan(0);
    const technical = html.slice(technicalStart);
    for (const label of ['SHA & CI','LEASE / PORT','Workforce Controller','RUNTIME JOBS','AI PROVIDERS','PROMPT ARCHITECT','RESULT / EVIDENCE']) {
      expect(technical).toContain(label);
    }
    for (const id of ['buildFacts','runtimeFacts','deviceTechnical','jobBoard','providerGrid','promptGrid','technicalResults']) {
      expect(technical).toContain(`id="${id}"`);
    }
  });

  it('uses a preview view-model adapter instead of claiming a final #146 business schema', async () => {
    const app = await read('public/web-v1/app.js');
    const adapter = await read('public/web-v1/company-control-tower-adapter.js');
    expect(app).toContain('buildCompanyControlTowerViewModel');
    expect(app).toContain("state.mode === 'mock'");
    expect(adapter).toContain('BUSINESS_CONTRACT_PENDING');
    expect(adapter).toContain('PREVIEW_ONLY');
    expect(adapter).toContain('previewBusiness');
    expect(adapter).not.toContain('authoritative: true');
    for (const forbidden of ['api.github.com','/api/web-control-status','TIGERIQ_GITHUB_TOKEN']) expect(app).not.toContain(forbidden);
  });

  it('keeps an iPhone-first safe-area and touch layout contract', async () => {
    const html = await read('public/web-v1/index.html');
    const css = await read('public/web-v1/styles.css');
    expect(html).toContain('width=device-width,initial-scale=1,viewport-fit=cover');
    expect(css).toContain('@media(max-width:820px)');
    expect(css).toContain('@media(max-width:520px)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('.sidebar{position:fixed');
    expect(css).toContain('.nav{display:flex;overflow:auto');
    expect(css).toContain('min-height:44px');
    expect(css).toContain('.goal-grid,.mission-board,.department-grid,.employee-grid,.owner-action-board,.outcome-board,.process-board,.technical-grid,.job-board,.provider-grid,.prompt-grid{grid-template-columns:1fr}');
  });

  it('keeps all mock data non-authoritative and labels financial data as unavailable', async () => {
    const mock = await read('public/web-v1/mock-data.js');
    expect(mock).toContain('authoritative: false');
    expect(mock).toContain("availability: 'unknown'");
    expect(mock).toContain("status: 'unknown'");
    expect(mock).toContain("availability: 'unavailable'");
    expect(mock).toContain('MẪU COMPANY-001');
    expect(mock).toContain('không tự điền số tài chính mẫu');
  });

  it('keeps root and legacy operations paths on the Company Control Tower bundle', async () => {
    const config = JSON.parse(await read('vercel.json'));
    expect(config.rewrites).toContainEqual({ source: '/', destination: '/web-v1/index.html' });
    expect(config.rewrites).toContainEqual({ source: '/operations', destination: '/web-v1/index.html' });
    expect(config.rewrites).toContainEqual({ source: '/command-center', destination: '/web-v1/index.html' });
    expect(config.rewrites).toContainEqual({ source: '/workforce', destination: '/web-v1/index.html' });
  });
});
