import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ LIVE UI V2 #4336', () => {
  it('keeps root and public exactly in sync', () => {
    expect(publicHtml).toBe(rootHtml);
  });

  it('renders the approved Project → Workstream → Flow → Job hierarchy as the primary surface', () => {
    expect(rootHtml).toContain('data-live-ui-version');
    expect(rootHtml).toContain('v2-portfolio-layout');
    expect(rootHtml).toContain('v2-project-sidebar');
    expect(rootHtml).toContain('v2-project-header');
    expect(rootHtml).toContain('v2-workstream-grid');
    expect(rootHtml).toContain('v2-flow-grid');
    expect(rootHtml).toContain('v2-evidence-grid');
    expect(rootHtml).toContain('TẦNG 1 · DỰ ÁN');
    expect(rootHtml).toContain('TẦNG 2');
    expect(rootHtml).toContain('TẦNG 3');
  });

  it('keeps projects independent and selectable without hard-coding one active project', () => {
    expect(rootHtml).toContain('function projectPortfolio()');
    expect(rootHtml).toContain('function projectPickerHtml(projects,selected)');
    expect(rootHtml).toContain('data-project-select');
    expect(rootHtml).toContain('selectedProjectId');
    expect(rootHtml).toContain('packageBuildAll(selectedProject.id)');
  });

  it('shows large workstreams and factual job flow from existing portfolio data', () => {
    expect(rootHtml).toContain('function ownerCleanPackageTabs(packages,selected)');
    expect(rootHtml).toContain('data-package-select');
    expect(rootHtml).toContain('function v2FlowGridHtml(pack,focus)');
    expect(rootHtml).toContain('data-package-row');
    expect(rootHtml).toContain('Nguồn & kế hoạch');
    expect(rootHtml).toContain('Phát triển');
    expect(rootHtml).toContain('Rà soát');
    expect(rootHtml).toContain('Phát hành & xác minh');
  });

  it('keeps all-JOB list as a secondary drill-down while preserving filters', () => {
    expect(rootHtml).toContain('<details id="rawWorkDetails" class="raw-work-details">');
    expect(rootHtml).not.toContain('<details id="rawWorkDetails" class="raw-work-details" open>');
    expect(rootHtml).toContain('Tất cả JOB / chi tiết kỹ thuật');
    expect(rootHtml).toContain('DANH SÁCH CÔNG VIỆC');
    expect(rootHtml).toContain('data-filter="action"');
    expect(rootHtml).toContain('data-filter="running"');
    expect(rootHtml).toContain('data-filter="done"');
  });

  it('keeps LIVE and API Health separated but directly linked', () => {
    expect(rootHtml).toContain('API Health ↗');
    expect(rootHtml).toContain('href="/index"');
    expect(rootHtml).toContain("fetch('/api/live-status',{cache:'no-store'})");
    expect(rootHtml).toContain('href="/work-ui.css"');
  });

  it('provides mobile Project → Workstream → Flow → Job navigation', () => {
    expect(rootHtml).toContain('v2-mobile-nav');
    expect(rootHtml).toContain('@media(max-width:700px)');
    expect(rootHtml).toContain('.v2-workstream-grid{grid-template-columns:1fr}');
    expect(rootHtml).toContain('.v2-flow-grid{grid-template-columns:1fr}');
    expect(rootHtml).toContain('.v2-evidence-grid{grid-template-columns:1fr}');
  });

  it('opens a Job detail view with Project, Workstream, Job, assignee and evidence context', () => {
    expect(rootHtml).toContain('id="drawerProject"');
    expect(rootHtml).toContain('id="drawerWorkstream"');
    expect(rootHtml).toContain('id="drawerJob"');
    expect(rootHtml).toContain("row?.projectName||'Chưa phân dự án'");
    expect(rootHtml).toContain("row?.workstreamName||row?.workPackageName");
    expect(rootHtml).toContain("row?.jobId||('GH-'+row.number)");
    expect(rootHtml).toContain('function populateDrawer(row)');
  });

  it('preserves verified-progress and reduced-motion guards', () => {
    expect(rootHtml).toContain('function verifiedProgress(row)');
    expect(rootHtml).toContain("['explicit_verified','checklist_verified','terminal']");
    expect(rootHtml).toContain('@media(prefers-reduced-motion:reduce)');
  });
});
