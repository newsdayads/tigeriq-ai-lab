import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ Live owner-readable workflow #3470', () => {
  it('keeps root and public TigerIQ Live exactly in sync', () => {
    expect(publicHtml).toBe(rootHtml);
  });

  it('keeps one six-stage Owner workflow', () => {
    for (const label of ['MỤC TIÊU','ĐIỀU PHỐI','THỰC THI','CÔNG CỤ & QUYỀN','KIỂM TRA','KẾT QUẢ']) {
      expect(rootHtml).toContain(label);
    }
    expect(rootHtml).toContain("Giai đoạn '+activeStage+'/6");
    expect(rootHtml).toContain('class="workflow-board"');
  });

  it('makes each work card understandable without opening the drawer', () => {
    for (const label of ['Đang làm','Đã xong','Tiếp theo','Kết quả']) {
      expect(rootHtml).toContain(label);
    }
    expect(rootHtml).toContain('class="flow-card-semantics"');
    expect(rootHtml).toContain('class="flow-card-meta"');
    expect(rootHtml).toContain('function ownerCardCurrent(row)');
    expect(rootHtml).toContain('function ownerCardDone(row)');
    expect(rootHtml).toContain('function ownerNextText(row)');
    expect(rootHtml).toContain("String(row?.nextStep||'').trim()");
  });

  it('keeps issue and PR identifiers as tertiary metadata, not the card headline', () => {
    expect(rootHtml).toContain("meta=['<span>#'+Number(row.number)+'</span>']");
    expect(rootHtml).toContain("if(pr)meta.push('<span>PR #'+pr+'</span>')");
    expect(rootHtml).toContain("<div class=\"flow-card-title\">'+esc(displayTitle(row.title))+'</div>");
  });

  it('draws only data-backed work relationships', () => {
    expect(rootHtml).toContain('function renderFlowEdges(container,edges)');
    expect(rootHtml).toContain("data-flow-node=\"job-'+Number(row.number)+'\"");
    expect(rootHtml).toContain("const parent=Number(row?.parentNumber)");
    expect(rootHtml).toContain("Array.isArray(row?.dependsOn)?row.dependsOn:[]");
    expect(rootHtml).toContain("addEdge('job-'+parent,to,'parent')");
    expect(rootHtml).toContain("addEdge('job-'+dep,to,'dependency')");
    expect(rootHtml).toContain("addEdge('job-'+Number(item.row.number),item.id,'worker')");
    expect(rootHtml).toContain("if(exec&&review)addEdge('job-'+Number(exec.number),'job-'+Number(review.number),'artifact')");
  });

  it('uses actual live worker/runtime fields instead of generic environment cards', () => {
    expect(rootHtml).toContain("const live=(snapshot?.workers||[]).find");
    expect(rootHtml).toContain("const provider=String(live?.provider||'').trim()");
    expect(rootHtml).toContain("const model=String(live?.model||'').trim()");
    expect(rootHtml).toContain("const source=String(live?.source||'').trim()");
    expect(rootHtml).not.toContain("title:worker+' · môi trường thực thi'");
  });

  it('keeps top summary at four compact KPIs', () => {
    for (const id of ['kpiLive','sumRunning','sumWorkers','overallPct']) {
      expect(rootHtml).toContain('id="'+id+'"');
    }
    for (const legacyId of ['sumWaiting','sumBlocked','sumOwner','sumSystem','sumDone']) {
      expect(rootHtml).not.toContain('id="'+legacyId+'"');
    }
  });

  it('shows progress only when verified', () => {
    expect(rootHtml).toContain('function verifiedProgress(row)');
    expect(rootHtml).toContain('progress.verified');
    expect(rootHtml).toContain("['explicit_verified','checklist_verified','terminal']");
    expect(rootHtml).toContain('✓ có bằng chứng tiến độ');
  });

  it('keeps review-only rows out of execution cards', () => {
    expect(rootHtml).toContain("filter(row=>!packageIsReviewEvidence(row)&&!['DONE','OWNER_GATE'].includes(workStatus(row)))");
    expect(rootHtml).toContain("packageIsReviewEvidence(row)||['REVIEW','VERIFY'].includes(workStatus(row))");
  });

  it('keeps technical detail secondary and drawer optional', () => {
    expect(rootHtml).toContain('<details id="rawWorkDetails" class="raw-work-details">');
    expect(rootHtml).not.toContain('<details id="rawWorkDetails" class="raw-work-details" open');
    expect(rootHtml).toContain('JOB kỹ thuật / chi tiết hệ thống');
    expect(rootHtml).toContain("node.addEventListener('click',()=>openDrawer(row,node))");
  });

  it('keeps mobile as a readable vertical flow and hides crossing SVG edges', () => {
    expect(rootHtml).toContain('@media(max-width:700px)');
    expect(rootHtml).toContain('.flow-row{grid-template-columns:1fr');
    expect(rootHtml).toContain('.flow-cards{grid-template-columns:1fr');
    expect(rootHtml).toContain('.flow-edge-layer{display:none}');
  });

  it('replaces unreadable hash tabs with readable non-shrinking work cards and owner attention ranking', () => {
    expect(rootHtml).toContain('THẺ VIỆC ĐANG MỞ');
    expect(rootHtml).toContain('class="flow-package-choice');
    expect(rootHtml).toContain('function packageOwnerAttentionRank(pack)');
    expect(rootHtml).toContain('function packageOwnerFocus(pack)');
    expect(rootHtml).toContain('const ownerPackages=packageOwnerSorted(packages)');
    expect(rootHtml).toContain('const picker=ownerPackagePicker(ownerPackages,Number(pack.root.number))');
    expect(rootHtml).not.toContain("const tabs=packages.length>1?");
    expect(rootHtml).toContain('.flow-package-choice{appearance:none;flex:0 0 300px');
    expect(rootHtml).toContain('.flow-package-choice{flex:0 0 min(82vw,330px);min-width:270px');
  });

});
