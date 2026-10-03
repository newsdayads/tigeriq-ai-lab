import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ Live Owner workflow flow #3414', () => {
  it('keeps root and public TigerIQ Live in sync', () => {
    expect(publicHtml).toBe(rootHtml);
  });

  it('renders exactly one six-stage Owner workflow metaphor', () => {
    for (const label of ['MỤC TIÊU','ĐIỀU PHỐI','THỰC THI','CÔNG CỤ & QUYỀN','KIỂM TRA','KẾT QUẢ']) {
      expect(rootHtml).toContain(label);
    }
    expect(rootHtml).toContain("Giai đoạn '+activeStage+'/6");
    expect(rootHtml).toContain('class="workflow-board"');
    expect(rootHtml).toContain('class="flow-rows"');
  });

  it('keeps the top Owner summary to four compact KPIs', () => {
    for (const id of ['kpiLive','sumRunning','sumWorkers','overallPct']) {
      expect(rootHtml).toContain('id="'+id+'"');
    }
    for (const legacyId of ['sumWaiting','sumBlocked','sumOwner','sumSystem','sumDone']) {
      expect(rootHtml).not.toContain('id="'+legacyId+'"');
    }
  });

  it('preserves truthful work-package data semantics underneath the simplified view', () => {
    expect(rootHtml).toContain('function packageBuildAll()');
    expect(rootHtml).toContain('function packageIsReviewEvidence(row)');
    expect(rootHtml).toContain("row?.reviewOnly===true");
    expect(rootHtml).toContain("workPriority(row)!=='P5'");
    expect(rootHtml).toContain('function packageOperationalFocus(rows)');
  });

  it('maps live work into execution, review and final Owner outcome stages', () => {
    expect(rootHtml).toContain('const executionRows=');
    expect(rootHtml).toContain('const reviewRows=');
    expect(rootHtml).toContain("workStatus(row)==='OWNER_GATE'");
    expect(rootHtml).toContain('data-flow-row');
    expect(rootHtml).toContain('data-flow-package');
  });

  it('shows progress only through verifiedProgress evidence', () => {
    expect(rootHtml).toContain('function verifiedProgress(row)');
    expect(rootHtml).toContain('progress.verified');
    expect(rootHtml).toContain("['explicit_verified','checklist_verified','terminal']");
  });

  it('keeps raw technical jobs visually secondary and collapsed by default', () => {
    expect(rootHtml).toContain('<details id="rawWorkDetails" class="raw-work-details">');
    expect(rootHtml).not.toContain('<details id="rawWorkDetails" class="raw-work-details" open');
    expect(rootHtml).toContain('JOB kỹ thuật / chi tiết hệ thống');
  });

  it('keeps the deep-dive drawer and existing technical surfaces available', () => {
    for (const id of ['ownerSummary','workList','workDrawer','nowRunning','apiWorkforce']) {
      expect(rootHtml).toContain('id="'+id+'"');
    }
  });

  it('uses a vertical single-column workflow on mobile', () => {
    expect(rootHtml).toContain('@media(max-width:700px)');
    expect(rootHtml).toContain('.flow-row{grid-template-columns:1fr');
    expect(rootHtml).toContain('.flow-cards{grid-template-columns:1fr');
  });

  it('keeps review-only rows out of execution cards', () => {
    expect(rootHtml).toContain("filter(row=>!packageIsReviewEvidence(row)&&!['DONE','OWNER_GATE'].includes(workStatus(row)))");
    expect(rootHtml).toContain("packageIsReviewEvidence(row)||['REVIEW','VERIFY'].includes(workStatus(row))");
  });
});
