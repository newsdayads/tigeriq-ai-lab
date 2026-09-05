import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

describe('public management view', () => {
  it('is read-only and exposes the five owner questions without public control surfaces', () => {
    for (const label of ['Đang làm', 'Ai phụ trách', 'Tiến độ', 'Vướng mắc', 'Cần anh Sơn']) expect(html).toContain(label);
    expect(html).toContain('CHỈ XEM · HTTPS');
    expect(html).not.toContain('id="instruction"');
    expect(html).not.toContain('id="dispatch"');
    expect(html).not.toContain('Giao việc cho Vy');
    expect(html).not.toContain('/api/control');
  });

  it('uses Vietnamese management language, Segoe UI and filtered public-system wording', () => {
    expect(html).toContain('font-family:"Segoe UI"');
    expect(html).toContain('Hàng đợi điều hành');
    expect(html).toContain('Nhân sự AI');
    expect(html).toContain('Trực quan từ dữ liệu thật');
    expect(html).toContain('Chưa có dữ liệu từ PC01');
    expect(html).not.toContain('AI Workforce');
    expect(html).not.toContain('PC01 Telemetry');
    expect(html).not.toContain('Routing & Orchestration');
    expect(html).not.toContain('Evidence PASS');
  });

  it('is mobile-safe and contains three real-data visualization surfaces', () => {
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('env(safe-area-inset-bottom)');
    expect(html).toContain('@media(max-width:620px)');
    expect(html).toContain('overflow-x:hidden');
    expect(html).toContain('id="issueRing"');
    expect(html).toContain('id="workforceBars"');
    expect(html).toContain('id="timeline"');
    expect(html).toContain("fetch('/api/company-progress'");
  });
});
