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

  it('keeps technical prefixes compact but never truncates the next action', () => {
    expect(html).toContain("while(/^\\[[^\\]]+\\]\\s*/.test(title))");
    expect(html).toContain('<b>Bước tới:</b>');
    expect(html).toContain('return raw;');
    expect(html).not.toContain("raw.length>72?raw.slice");
    expect(html).toContain('white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere');
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

  it('keeps the newest API snapshot instead of regressing to an older browser cache', () => {
    expect(html).toContain('function snapshotTimestamp(value)');
    expect(html).toContain('snapshotTimestamp(raw)>=snapshotTimestamp(cached)');
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

  it('keeps reduced-motion and truthful working/indeterminate animation', () => {
    expect(html).toContain('@media(prefers-reduced-motion:reduce)');
    expect(html).toContain('.work-row.status-working');
    expect(html).toContain('recently-updated');
    expect(html).toContain('progress-indeterminate');
    expect(html).toContain("const activeWithoutPercent=['WORKING','REVIEW','VERIFY'].includes(status)");
    expect(html).toContain('Chưa đủ dữ liệu để tính %');
  });

  it('keeps cards compact and moves execution internals into detail-only context', () => {
    expect(html).toContain('executionLabelMap');
    expect(html).toContain('SẴN SÀNG CHẠY');
    expect(html).toContain('TỰ CHẠY KHI CÓ TÀI NGUYÊN');
    expect(html).not.toContain('<b>AI giữ:</b>');
    expect(html).not.toContain('<b>Quyền chạy:</b>');
    expect(html).not.toContain('<b>Lý do chờ:</b>');
    expect(html).toContain('class="work-quick ');
    expect(html).toContain('-webkit-line-clamp:2');
  });

  it('keeps review/verify visibly non-terminal and reserves 100 percent for completed work', () => {
    expect(html).toContain("REVIEW:'ĐANG RÀ SOÁT'");
    expect(html).toContain("VERIFY:'ĐANG XÁC MINH'");
    expect(html).toContain("REVIEW:'Phần thực hiện đã xong hoặc gần xong; đang được kiểm tra độc lập, chưa phải hoàn tất.'");
    expect(html).toContain("VERIFY:'Đã qua bước rà soát; đang xác minh bản phát hành hoặc kết quả thực tế, chưa phải hoàn tất.'");
    expect(html).toContain("const terminal100=status==='DONE'&&source==='terminal'&&pct===100");
    expect(html).toContain("pct>=0&&pct<100");
  });

  it('removes redundant Live header chrome and health shortcut', () => {
    expect(html).toContain('TigerIQ <b>Live</b></h1>');
    expect(html).not.toContain('· Luồng công việc');
    expect(html).not.toContain('Nhận việc → điều phối → thực hiện → kiểm tra → kết quả');
    expect(html).not.toContain('aria-label="API Health"');
    expect(html).not.toContain('v2-global-nav" aria-label="Điều hướng TigerIQ Live"');
  });

  it('#4464 renders Owner result inbox cards and preserves an explicit empty state', () => {
    expect(html).toContain('id="drawerOwnerResults"');
    expect(html).toContain('renderOwnerResultInbox(row)');
    expect(html).toContain('ownerResultInbox===true');
    expect(html).toContain('Chưa có kết quả hoàn tất');
    expect(html).toContain('Chưa tải được kết quả hoàn tất');
    expect(html).toContain('owner-result-card');
    expect(html).toContain('id="drawerProgressSection"');
    expect(html).toContain('id="drawerStatusSection"');
    expect(html).toContain('id="drawerEvidenceSection"');
    expect(html).toContain('Mở GitHub ↗');
  });
});


describe('TigerIQ Core Health Work Order steps restoration', () => {
  const source = fs.readFileSync(new URL('../apps/tigeriq-core/dashboard.html', import.meta.url), 'utf8');
  const start = source.indexOf('const structuredSteps=Array.isArray(row.progressSteps)');
  const end = source.indexOf(';workDetailCurrent.textContent=', start);
  const snippet = start >= 0 && end > start ? source.slice(start, end) : '';
  const render = (row, stale = false) => {
    expect(snippet).not.toBe('');
    const header = { textContent: '' }, section = { hidden: true, querySelector: () => header }, steps = { innerHTML: '' };
    const document = { getElementById: (id) => id === 'workDetailStepsSection' ? section : id === 'workDetailSteps' ? steps : null };
    const esc = (value) => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const result = new Function('row', 'document', 'workProjection', 'esc', snippet + ';return { visible: !stepSection.hidden, html: stepsEl.innerHTML, title: stepSection.querySelector("h3").textContent };');
    return result(row, document, { stale }, esc);
  };
  const actualFourSteps = [
    { title: 'R00 — Xác minh chữ ký lỗi', done: false },
    { title: 'R01 — Sửa hàng đợi', done: false },
    { title: 'R02 — Kiểm thử', done: false },
    { title: 'R03 — Nghiệm thu', done: false },
  ];

  it('restores GitHub R00–R03 even when executionSteps is empty', () => {
    const view = render({ workKind: 'WORK', progressSteps: actualFourSteps, executionSteps: [], progressChecklistVerified: false });
    expect(view.visible).toBe(true);
    expect(view.title).toBe('DANH SÁCH BƯỚC THỰC HIỆN');
    for (const step of actualFourSteps) expect(view.html).toContain(step.title);
    expect(view.html).not.toContain('class="work-detail-step done"');
  });

  it('does not assert checked/verified progress without a trusted proof', () => {
    const steps = [{ title: 'R00', done: true }, { title: 'R01', done: false }];
    const notVerified = render({ workKind: 'WORK', progressSteps: steps, progressChecklistVerified: false });
    expect(notVerified.html).not.toContain('class="work-detail-step done"');
    const verified = render({ workKind: 'WORK', progressSteps: steps, progressChecklistVerified: true });
    expect(verified.html).toContain('class="work-detail-step done"');
    const stale = render({ workKind: 'WORK', progressSteps: steps, progressChecklistVerified: true }, true);
    expect(stale.html).not.toContain('class="work-detail-step done"');
  });

  it('shows an explicit empty state rather than silently hiding an unfinished card', () => {
    const missing = render({ workKind: 'WORK', progressSteps: [], executionSteps: [] });
    expect(missing.visible).toBe(true);
    expect(missing.html).toContain('Chưa có danh sách bước');
    const metadata = render({ workKind: 'SYSTEM', progressSteps: [], executionSteps: [] });
    expect(metadata.visible).toBe(false);
  });
});
