import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { MOCK_CONTROLLER_SNAPSHOT } from '../public/web-v1/mock-data.js';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Web Control V1 company dashboard', () => {
  it('is a company operations UI, not the legacy chat surface', async () => {
    const html = await read('public/web-v1/index.html');
    for (const text of ['Bảng điều hành công ty','Tiến độ Web V1','Phòng ban & nhân viên AI','AI đang dùng','Công việc & trạng thái','Kết quả & kiểm tra','Lỗi & khôi phục','Nhật ký hoạt động']) expect(html).toContain(text);
    expect(html).toContain('WEB CONTROL V1');
    expect(html).not.toContain('Chat với TigerIQ');
    expect(html).not.toContain('Nhập tin nhắn');
  });

  it('contains progress, organization, provider, work, quality, recovery and audit visual components', async () => {
    const html = await read('public/web-v1/index.html');
    const css = await read('public/web-v1/styles.css');
    for (const id of ['progressRing','readinessList','departmentGrid','employeeGrid','providerGrid','jobBoard','resultList','checkTable','recoveryGrid','activityTimeline']) expect(html).toContain(`id="${id}"`);
    expect(css).toContain('.progress-ring');
    expect(css).toContain('.department-grid');
    expect(css).toContain('.quality-pipeline');
  });

  it('ships realistic but unmistakably non-authoritative sample data', () => {
    expect(MOCK_CONTROLLER_SNAPSHOT.source).toEqual(expect.objectContaining({ mode:'mock', authoritative:false }));
    expect(MOCK_CONTROLLER_SNAPSHOT.departments.length).toBeGreaterThanOrEqual(4);
    expect(MOCK_CONTROLLER_SNAPSHOT.employees.length).toBeGreaterThanOrEqual(4);
    expect(MOCK_CONTROLLER_SNAPSHOT.providers.map(x=>x.providerId)).toContain('gemini');
    expect(MOCK_CONTROLLER_SNAPSHOT.jobs.some(x=>x.stage==='BLOCKED')).toBe(true);
    expect(MOCK_CONTROLLER_SNAPSHOT.results.some(x=>x.review?.state==='PASS' && x.judge?.state==='PASS')).toBe(true);
    expect(MOCK_CONTROLLER_SNAPSHOT.jobs.every(x=>x.isMock===true)).toBe(true);
  });

  it('does not call GitHub/Vercel runtime APIs from the company dashboard client', async () => {
    const app = await read('public/web-v1/app.js');
    const client = await read('public/web-v1/controller-client.js');
    for (const forbidden of ['api.github.com','/api/web-control-status','/api/auto-work','/api/single-door']) { expect(app).not.toContain(forbidden); expect(client).not.toContain(forbidden); }
  });
});
