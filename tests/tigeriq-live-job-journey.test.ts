import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ Live job journey #3150', () => {
  it('keeps root and public TigerIQ Live in sync', () => {
    expect(publicHtml).toBe(rootHtml);
  });

  it('adds a single-job journey without removing the existing owner dashboard', () => {
    expect(rootHtml).toContain('id="jobJourney"');
    for (const text of ['JOB TRỌNG TÂM','Mục tiêu','Phân việc','Thực thi','Rà soát','Xác minh','Hoàn tất']) {
      expect(rootHtml).toContain(text);
    }
    for (const id of ['ownerSummary','workList','workDrawer']) {
      expect(rootHtml).toContain('id="'+id+'"');
    }
  });

  it('derives focus and stage state only from the existing snapshot contract', () => {
    expect(rootHtml).toContain('function journeyFocusRow()');
    expect(rootHtml).toContain('function journeyStageState(status,index,assigned)');
    expect(rootHtml).toContain('snapshot?.activeWork');
    expect(rootHtml).toContain('snapshot?.openWork');
    expect(rootHtml).not.toContain('/api/job-journey');
  });

  it('fails safe on stale data and does not invent progress', () => {
    expect(rootHtml).toContain('Dữ liệu hiện tại đã cũ nên chưa dựng luồng để tránh hiển thị sai.');
    expect(rootHtml).toContain('const {pct,verified}=verifiedProgress(row)');
    expect(rootHtml).toContain("verified?'<div class=\"journey-progress\"");
  });

  it('supports multiple workers and exposes blockers at the affected journey', () => {
    expect(rootHtml).toContain('function journeyWorkers(row)');
    expect(rootHtml).toContain('row?.participants');
    expect(rootHtml).toContain('row?.workers');
    expect(rootHtml).toContain("Đang có '+workers.length+' nhân sự tham gia / có thể chạy song song");
    expect(rootHtml).toContain('<b>Bị chặn:</b>');
  });

  it('keeps the job journey mobile-first and opens the existing detail drawer', () => {
    expect(rootHtml).toContain('@media(max-width:700px)');
    expect(rootHtml).toContain('.journey-rail{grid-template-columns:1fr');
    expect(rootHtml).toContain('openDrawer(row,shell)');
  });
});
