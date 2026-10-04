import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ Live Owner Clean View #3833', () => {
  it('keeps root and public exactly in sync', () => {
    expect(publicHtml).toBe(rootHtml);
  });

  it('keeps Project → Work Package → Live Flow as the primary Owner surface', () => {
    expect(rootHtml).toContain('function projectPickerHtml(projects,selected)');
    expect(rootHtml).toContain('function ownerCleanPackageTabs(packages,selected)');
    expect(rootHtml).toContain('function ownerCleanStages(pack,focus)');
    expect(rootHtml).toContain('class="owner-clean-board"');
    expect(rootHtml).toContain('class="owner-clean-flow"');
    expect(rootHtml).toContain('Giao việc');
    expect(rootHtml).toContain('Điều phối');
    expect(rootHtml).toContain('Thực hiện');
    expect(rootHtml).toContain('Kiểm tra');
    expect(rootHtml).toContain('Kết quả');
  });

  it('removes summary overload and technical metadata from the primary board', () => {
    expect(rootHtml).toContain('#ownerSummary{display:none!important}');
    expect(rootHtml).toContain('Chi tiết kỹ thuật');
    expect(rootHtml).not.toContain('mục kỹ thuật ẩn');
    expect(rootHtml).toContain('<details id="rawWorkDetails" class="raw-work-details">');
    expect(rootHtml).not.toContain('<details id="rawWorkDetails" class="raw-work-details" open');
  });

  it('keeps status-driven live motion with reduced-motion support', () => {
    expect(rootHtml).toContain('ownerCleanStateClass');
    expect(rootHtml).toContain('clean-live-pulse');
    expect(rootHtml).toContain('clean-review-pulse');
    expect(rootHtml).toContain('@media(prefers-reduced-motion:reduce)');
  });

  it('uses the same responsive system on mobile', () => {
    expect(rootHtml).toContain('@media(max-width:700px)');
    expect(rootHtml).toContain('.owner-clean-flow{grid-template-columns:1fr');
    expect(rootHtml).toContain('.owner-clean-detail{width:100%');
  });

  it('keeps audit fixes wired into the Owner Clean View', () => {
    expect(rootHtml).toContain("coordinationHasEvidence?'DONE':'WAITING'");
    expect(rootHtml).toContain("focusState==='OWNER_GATE'&&focus?.technicalComplete===true");
    expect(rootHtml).toContain("reviewUnresolved?'WAITING'");
    expect(rootHtml).toContain("pack.aggregate?.label||stateLabel[state]||state");
    expect(rootHtml).toContain("const next=shortNext(focus)||'Chưa có bước kế tiếp được xác minh'");
  });

  it('preserves verified-progress and raw evidence infrastructure', () => {
    expect(rootHtml).toContain('function verifiedProgress(row)');
    expect(rootHtml).toContain("['explicit_verified','checklist_verified','terminal']");
    expect(rootHtml).toContain('function populateDrawer(row)');
  });
});
