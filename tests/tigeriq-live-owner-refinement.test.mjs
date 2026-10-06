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

  it('centers the detail modal and uses deterministic owner-project handoff with explicit fallback', () => {
    expect(html).toContain('left:50%;right:auto');
    expect(html).toContain('transform:translate(-50%,-50%) scale(1)');
    expect(html).toContain('Mở TigerIQ + copy yêu cầu ↗');
    expect(html).toContain('Chat thường dự phòng ↗');
    expect(html).toContain('navigator.clipboard?.writeText');
    expect(html).toContain('TIGERIQ_OWNER_CHATGPT_PROJECT_URL');
    expect(html).toContain('g-p-6a925c470aa08191a10595e215d04f4e/project');
    expect(html).not.toContain('g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab');
    expect(html).toContain('openChatGptHandoff(TIGERIQ_OWNER_CHATGPT_PROJECT_URL,prompt)');
    expect(html).not.toContain("TIGERIQ_OWNER_CHATGPT_PROJECT_URL+'?prompt='");
    expect(html).toContain('drawerAskVyFallback');
    expect(html).toContain('https://chatgpt.com/?prompt=');
    expect(html).toContain('bootstrap/00_TIGERIQ_LOADER.md');
    expect(html).toContain('docs/CURRENT_STATE.md');
    expect(html).toContain('issue #504');
    expect(html).toContain('issue #280');
    expect(html).toContain('issue #335');
    expect(html).toContain('SOURCE_UNAVAILABLE');
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

  it('gates runtime focus on fresh data and renders missing API evidence as unavailable', () => {
    expect(html).toContain("const fresh=!(snapshot?.staleAll||snapshot?.workProjection?.stale)");
    expect(html).toContain('Dữ liệu runtime đã cũ · chưa xác nhận job đang chạy.');
    expect(html).toContain('Number.isFinite(Number(a.stabilityRounds))');
    expect(html).toContain('Number.isFinite(Number(a.realJobs))');
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

  it('shows display state separately from execution eligibility on work cards', () => {
    expect(html).toContain('executionLabelMap');
    expect(html).toContain('SẴN SÀNG CHẠY');
    expect(html).toContain('TỰ CHẠY KHI CÓ TÀI NGUYÊN');
    expect(html).toContain('<b>AI giữ:</b>');
    expect(html).toContain('<b>Quyền chạy:</b>');
    expect(html).toContain('<b>Lý do chờ:</b>');
    expect(html).toContain('<b>Bước tới:</b>');
  });
});
