import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const live = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const livePublic = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');
const projects = fs.readFileSync(new URL('../projects.html', import.meta.url), 'utf8');
const projectsPublic = fs.readFileSync(new URL('../public/projects.html', import.meta.url), 'utf8');

describe('TigerIQ LIVE mobile work-list split #4372', () => {
  it('keeps root/public LIVE and Projects surfaces in exact sync', () => {
    expect(livePublic).toBe(live);
    expect(projectsPublic).toBe(projects);
  });

  it('makes LIVE a work-list surface and removes project blocks from layout', () => {
    expect(live).toContain('<a class="active" href="/command-center">Công việc</a>');
    expect(live).toContain('<a href="/projects">Dự án</a>');
    expect(live).toContain('id="missionControl" class="mc-shell" aria-label="Mission Control" hidden');
    expect(live).toContain('id="projectDrilldown" class="project-drilldown" hidden');
    expect(live).toContain('id="rawWorkDetails" class="raw-work-details live-work-shell" open');
    expect(live).toContain('id="workListHeading">DANH SÁCH CÔNG VIỆC');
    expect(live).toContain('id="workList" class="work-list"');
  });

  it('preserves Project → Workstream → Job context in each work row', () => {
    expect(live).toContain('class="work-path"');
    expect(live).toContain("row?.projectName||'Chưa phân dự án'");
    expect(live).toContain("row?.workstreamName||row?.workPackageName");
    expect(live).toContain("row?.jobId||('GH-'+row.number)");
    expect(live).toContain("row?.assignee||workerFrom(row)");
  });

  it('builds the separate Projects page from live data instead of a hard-coded catalog', () => {
    expect(projects).toContain("fetch('/api/live-status',{cache:'no-store'})");
    expect(projects).toContain('data?.projectPortfolio||[]');
    expect(projects).toContain('row?.projectId');
    expect(projects).toContain('row?.workstreamId||row?.workPackageId');
    expect(projects).not.toContain('TigerIQ Mobile Worker');
    expect(projects).not.toContain('TigerIQ News');
    expect(projects).not.toContain('Revenue Lab');
  });

  it('keeps desktop/mobile navigation between Work and Projects', () => {
    expect(projects).toContain('<a href="/command-center">Công việc</a><a class="active" href="/projects">Dự án</a>');
    expect(live).toContain('<nav class="v2-mobile-nav" aria-label="Điều hướng mobile"><a class="active" href="/command-center">Công việc</a><a href="/projects">Dự án</a></nav>');
    expect(projects).toContain('<nav class="mobile-nav" aria-label="Điều hướng mobile"><a href="/command-center">Công việc</a><a class="active" href="/projects">Dự án</a></nav>');
  });
});
