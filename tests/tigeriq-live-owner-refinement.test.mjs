import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');

describe('TigerIQ Live Owner refinement #2887', () => {
  it('keeps mobile summary compact and separates truthful status buckets', () => {
    for (const text of ['Đang chạy thật','Đang chờ','Bị chặn thật','Chờ anh Sơn','Hệ thống','Đã xong']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('grid-template-columns:repeat(3,minmax(0,1fr))');
    expect(html).not.toContain('<div class="summary-tile"><span>Còn lại</span>');
  });

  it('shows verified terminal completion rather than averaging guessed in-flight percentages', () => {
    expect(html).toContain("const completion=snapshot?.completionProgress||{}");
    expect(html).toContain("completion?.source==='terminal_completion'");
    expect(html).toContain("việc hoàn tất");
  });

  it('shortens technical titles and next action on the card', () => {
    expect(html).toContain("while(/^\\[[^\\]]+\\]\\s*/.test(title))");
    expect(html).toContain('<b>Bước tới:</b>');
    expect(html).not.toContain('<b>Tiếp:</b>');
  });

  it('centers the detail modal and adds one-tap ChatGPT review handoff', () => {
    expect(html).toContain('left:50%;right:auto');
    expect(html).toContain('transform:translate(-50%,-50%) scale(1)');
    expect(html).toContain('Hỏi / Duyệt với Vy ↗');
    expect(html).toContain('navigator.clipboard?.writeText');
    expect(html).toContain('chatgpt.com/g/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab/project?prompt=');
  });

  it('does not expose the old negative owner-gate worker label', () => {
    expect(html).not.toContain('CHƯA CÓ NGƯỜI LÀM');
    expect(html).toContain("row?.technicalComplete?'ĐÃ XONG KỸ THUẬT':'CHỜ ANH SƠN'");
  });

  it('uses projected WORKING rows and excludes unverified provider fallback health', () => {
    expect(html).toContain("workStatus(row)==='WORKING'");
    expect(html).toContain("a.verified===true");
    expect(html).toContain("const healthValue=");
  });

  it('preserves explicit owner next actions and opens ChatGPT exactly once', () => {
    expect(html).toContain("const raw=String(row?.nextStep||'').trim()");
    expect(html).toContain("link.target='_blank';link.rel='noopener noreferrer'");
    expect(html).not.toContain("if(!opened)location.href=url");
  });

  it('renders actual runtime focus and API workforce stability summary', () => {
    expect(html).toContain('Việc đang chạy ngay lúc này');
    expect(html).toContain('apiWorkforceSummary');
    expect(html).toContain('Provider khỏe');
    expect(html).toContain('Vòng ổn định');
    expect(html).toContain('Job thật');
  });

  it('keeps reduced-motion and truth-based working animation', () => {
    expect(html).toContain('@media(prefers-reduced-motion:reduce)');
    expect(html).toContain('.work-row.status-working');
    expect(html).toContain('recently-updated');
  });
});
