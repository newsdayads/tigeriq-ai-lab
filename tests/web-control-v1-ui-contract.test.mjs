import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Web Control V1 UI architecture', () => {
  it('contains the full Vietnamese company-control surfaces requested for V1', async () => {
    const html = await read('public/web-v1/index.html');
    for (const label of ['Tổng quan','Giao mục tiêu','Công việc','Phòng ban & nhân sự','AI đang dùng','Prompt Architect','Kết quả & kiểm tra','Lỗi & khôi phục','Nhật ký','Kết nối']) expect(html).toContain(label);
    expect(html).toContain('BẢNG ĐIỀU HÀNH V1');
    expect(html).toContain('Bảng điều hành công ty');
    expect(html).toContain('<span>Sếp</span>');
    expect(html).toContain('Mục tiêu của Sếp');
    expect(html).not.toContain('Nhập tin nhắn');
    expect(html).not.toContain('Chat với TigerIQ');
  });

  it('uses Workforce Controller contract and does not use GitHub/Vercel as runtime queue/state', async () => {
    const client = await read('public/web-v1/controller-client.js');
    const app = await read('public/web-v1/app.js');
    expect(client).toContain('/api/web/v1/snapshot');
    expect(client).toContain('/api/workforce/status');
    for (const forbidden of ['api.github.com','/api/control','/api/web-control-status','TIGERIQ_GITHUB_TOKEN']) { expect(client).not.toContain(forbidden); expect(app).not.toContain(forbidden); }
    expect(app).toContain('s.company?.readiness');
    expect(app).toContain("state.mode==='controller'");
    expect(app).toContain('· Sếp');
    for (const oldLabel of ['OWNER INTENT','WORK QUEUE','ORGANIZATION','RESULT PIPELINE','RECOVERY CENTER','AUDIT TRAIL','PC01 CONNECTIVITY']) expect(app).not.toContain(oldLabel);
  });

  it('keeps an iPhone-safe responsive layout contract', async () => {
    const html = await read('public/web-v1/index.html');
    const css = await read('public/web-v1/styles.css');
    expect(html).toContain('width=device-width,initial-scale=1,viewport-fit=cover');
    expect(css).toContain('@media(max-width:820px)');
    expect(css).toContain('@media(max-width:520px)');
    expect(css).toContain('.sidebar{position:fixed');
    expect(css).toContain('.nav{display:flex;overflow:auto}');
    expect(css).toContain('.hero-grid,.two-col{grid-template-columns:1fr}');
    expect(css).toContain('.department-grid,.department-grid.large,.employee-grid,.provider-grid,.prompt-grid,.recovery-grid,.device-grid,.job-board{grid-template-columns:1fr}');
    expect(css).toContain('.result-card .gate-grid{grid-template-columns:1fr 1fr}');
  });

  it('makes root/operations/workforce views static Web V1 while keeping Vercel outside control plane', async () => {
    const config = JSON.parse(await read('vercel.json'));
    expect(config.rewrites).toContainEqual({source:'/',destination:'/web-v1/index.html'});
    expect(config.rewrites).toContainEqual({source:'/operations',destination:'/web-v1/index.html'});
    expect(config.rewrites).toContainEqual({source:'/workforce',destination:'/web-v1/index.html'});
  });

  it('keeps mock data visibly non-authoritative and avoids fake live state', async () => {
    const mock = await read('public/web-v1/mock-data.js');
    expect(mock).toContain('authoritative: false');
    expect(mock).toContain("availability: 'unknown'");
    expect(mock).toContain("status: 'unknown'");
    expect(mock).toContain('DỮ LIỆU MẪU V1');
  });
});
