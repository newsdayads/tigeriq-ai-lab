import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ LIVE Owner Operations V3 #4351', () => {
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


  it('keeps project order stable instead of moving projects by runtime status', () => {
    expect(rootHtml).toContain("if(source.length)return [...source].sort((a,b)=>Number(a.order||900)-Number(b.order||900)");
    expect(rootHtml).not.toContain("packageStatusRank(projectStatus(a))-packageStatusRank(projectStatus(b))||Number(a.order||900)");
  });

  it('shows one owner-operational snapshot with location, assignee, current, done, next, blocker and age', () => {
    expect(rootHtml).toContain('function v3OwnerOpsHtml(row)');
    expect(rootHtml).toContain('v3-owner-ops');
    expect(rootHtml).toContain('Đang làm gì');
    expect(rootHtml).toContain('Vừa xong');
    expect(rootHtml).toContain('Bước tiếp theo');
    expect(rootHtml).toContain('Blocker');
    expect(rootHtml).toContain('Cập nhật');
    expect(rootHtml).toContain('function ownerAgeText(value)');
  });

  it('shows an unmistakable live running lane for actual WORKING jobs', () => {
    expect(rootHtml).toContain('v3-running-lane');
    expect(rootHtml).toContain('ĐANG CHẠY NGAY LÚC NÀY');
    expect(rootHtml).toContain('data-running-job');
    expect(rootHtml).toContain('@keyframes v3-live-ring');
    expect(rootHtml).toContain('@keyframes v3-dot-pulse');
    expect(rootHtml).toContain('@keyframes v3-scan');
  });

  it('does not present a fake clickable Việc lớn control', () => {
    expect(rootHtml).toContain('<span class="v2-tab-label active">Việc lớn (');
    expect(rootHtml).not.toContain('<button class="active" type="button">Việc lớn (');
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

  it('keeps all-JOB list visible by default while preserving filters', () => {
    expect(rootHtml).toContain('<details id="rawWorkDetails" class="raw-work-details" open>');
    expect(rootHtml).toContain('Tất cả JOB / chi tiết kỹ thuật');
    expect(rootHtml).toContain('ĐANG HIỂN THỊ');
    expect(rootHtml).toContain('DANH SÁCH CÔNG VIỆC');
    expect(rootHtml).toContain('data-filter="action"');
    expect(rootHtml).toContain('data-filter="running"');
    expect(rootHtml).toContain('data-filter="done"');
  });


  it('uses vivid status colors and bounded motion with reduced-motion fallback', () => {
    expect(rootHtml).toContain('.v2-project-choice.is-working');
    expect(rootHtml).toContain('.v2-project-choice.is-blocked');
    expect(rootHtml).toContain('.v2-workstream-card.is-review');
    expect(rootHtml).toContain('.v2-flow-stage:nth-child(4)');
    expect(rootHtml).toContain('.v2-flow-job.is-working');
    expect(rootHtml).toContain('.v2-flow-job.is-review');
    expect(rootHtml).toContain('.v2-flow-job.is-blocked');
    expect(rootHtml).toContain('.v2-flow-job.is-done');
    expect(rootHtml).toContain('@keyframes v2-working-pulse');
    expect(rootHtml).toContain('@keyframes v2-review-breathe');
    expect(rootHtml).toContain('@keyframes v2-blocked-alert');
    expect(rootHtml).toContain('@keyframes v2-progress-flow');
    expect(rootHtml).toContain('@media(prefers-reduced-motion:reduce)');
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
    expect(rootHtml).toContain('.v3-running-dot,.v3-running-pulse');
  });
});
