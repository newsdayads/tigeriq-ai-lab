import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const live = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const livePublic = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');
const projects = fs.readFileSync(new URL('../projects.html', import.meta.url), 'utf8');

describe('TigerIQ LIVE fast-glance responsive #4471', () => {
  it('keeps root/public LIVE surfaces in exact sync', () => {
    expect(livePublic).toBe(live);
  });

  it('keeps LIVE focused on work only and removes redundant top/mobile navigation', () => {
    expect(live).toContain('TigerIQ <b>Live</b></h1>');
    expect(live).not.toContain('· Luồng công việc');
    expect(live).not.toContain('Nhận việc → điều phối → thực hiện → kiểm tra → kết quả');
    expect(live).not.toContain('class="health-utility"');
    expect(live).not.toContain('<nav class="v2-global-nav"');
    expect(live).not.toContain('<nav class="v2-mobile-nav"');
    expect(live).toContain('id="workListHeading">DANH SÁCH CÔNG VIỆC');
    expect(live).toContain('id="workList" class="work-list"');
  });

  it('moves project/workstream/job details off cards while preserving them in the detail drawer', () => {
    expect(live).not.toContain('class="work-path"');
    expect(live).toContain('id="drawerProject"');
    expect(live).toContain('id="drawerWorkstream"');
    expect(live).toContain('id="drawerJob"');
    expect(live).toContain("row?.projectName||'Chưa phân dự án'");
    expect(live).toContain("row?.workstreamName||row?.workPackageName||'Chưa phân nhánh'");
    expect(live).toContain("row?.jobId||('GH-'+row.number)");
  });

  it('keeps the separate Projects page available from its direct route and live data', () => {
    expect(projects).toContain("fetch('/api/live-status',{cache:'no-store'})");
    expect(projects).toContain('data?.projectPortfolio||[]');
    expect(projects).toContain('row?.projectId');
    expect(projects).toContain('row?.workstreamId||row?.workPackageId');
  });

  it('uses explicit responsive column counts from 4K to mobile landscape/portrait', () => {
    expect(live).toContain('@media(min-width:3200px){.work-list{grid-template-columns:repeat(6,minmax(0,1fr))}');
    expect(live).toContain('@media(min-width:2200px) and (max-width:3199px){.work-list{grid-template-columns:repeat(5,minmax(0,1fr))}');
    expect(live).toContain('@media(min-width:1600px) and (max-width:2199px){.work-list{grid-template-columns:repeat(4,minmax(0,1fr))}');
    expect(live).toContain('@media(min-width:1180px) and (max-width:1599px){.work-list{grid-template-columns:repeat(3,minmax(0,1fr))}');
    expect(live).toContain('@media(min-width:760px) and (max-width:1179px){.work-list{grid-template-columns:repeat(2,minmax(0,1fr))}');
    expect(live).toContain('@media(max-width:759px){.work-list{grid-template-columns:1fr}');
  });
});
