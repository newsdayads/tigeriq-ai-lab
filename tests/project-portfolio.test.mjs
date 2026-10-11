import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { annotatePortfolioRows, buildProjectPortfolio, buildPortfolioGroups, CANONICAL_PORTFOLIO_GROUPS, classifyProject, mergePortfolioWorkRows } from '../apps/tigeriq-core/project-portfolio.mjs';

describe('TigerIQ LIVE project portfolio', () => {
  it('does not let cross-project descriptions reassign portfolio issue ownership', () => {
    const row = { number: 4640, title: '[P0][PORTFOLIO] Chuẩn hóa 7 dự án' };
    const issue = { title: row.title, body: 'TigerIQ News / Media\nPaperclip vNext\nRevenue Lab\nTigerIQ Driver\nDeXCam Personal' };
    expect(classifyProject(row, issue).id).toBe('tigeriq-platform');
    expect(classifyProject(row, { ...issue, body: 'PROJECT_ID=tigeriq-news\n' + issue.body }).id).toBe('tigeriq-news');
  });
  it('uses explicit project fields for future projects', () => {
    const project = classifyProject({ number: 9001, title: '[P2] Future product' }, {
      number: 9001,
      title: '[P2] Future product',
      body: 'PROJECT_ID=alpha-lab\nPROJECT_NAME=Alpha Lab',
    });
    expect(project).toEqual({ id: 'alpha-lab', name: 'Alpha Lab', order: 900, kind: 'project' });
  });

  it('maps historical TigerIQ Media naming to canonical TigerIQ News', () => {
    const rows = annotatePortfolioRows([{ number: 3033, title: '[P1][TIGERIQ MEDIA][SECURITY] Admin auth', workKind: 'WORK', status: 'WORKING' }]);
    expect(rows[0].projectId).toBe('tigeriq-news');
    expect(rows[0].projectName).toBe('TigerIQ News');
  });

  it('collapses v0.22 Android work and hides older technical versions from primary view', () => {
    const rows = annotatePortfolioRows([
      { number: 3683, title: '[P1][ANDROID][LIVE] v0.22 Live Worker', workKind: 'WORK', status: 'WORKING' },
      { number: 3710, title: '[P1][ANDROID][LIVE] v0.22 Live Worker — Core dispatch', workKind: 'WORK', status: 'WAITING' },
      { number: 3597, title: '[P1][ANDROID] v0.21 release review', workKind: 'WORK', status: 'WAITING' },
    ]);
    expect(rows[0].workPackageId).toBe('mobile-v0-22');
    expect(rows[1].workPackageId).toBe('mobile-v0-22');
    expect(rows[2].portfolioHidden).toBe(true);
    const projects = buildProjectPortfolio(rows);
    const mobile = projects.find((project) => project.id === 'tigeriq-mobile-worker');
    expect(mobile.workPackageCount).toBe(1);
    expect(mobile.workPackages[0].name).toBe('Live Worker v0.22');
    expect(mobile.hiddenTechnicalItems).toBe(1);
  });

  it('inherits parent work package for review evidence without collapsing versioned Android work', () => {
    const rows = annotatePortfolioRows([
      { number: 3730, title: '[P1][TIGERIQ LIVE] Project hierarchy', workKind: 'WORK', status: 'WORKING' },
      { number: 3753, parentNumber: 3730, title: '[P1][REVIEW][NV11] PR #3742 exact-head', workKind: 'WORK', status: 'REVIEW', reviewOnly: true },
      { number: 2949, title: '[P3][ANDROID] Mobile Worker v0.21', workKind: 'WORK', status: 'WAITING' },
      { number: 3683, parentNumber: 2949, title: '[P1][ANDROID][LIVE] v0.22 Live Worker', workKind: 'WORK', status: 'WORKING' },
    ]);
    expect(rows.find((row) => row.number === 3753)?.workPackageId).toBe('owner-ui');
    expect(rows.find((row) => row.number === 3683)?.workPackageId).toBe('mobile-v0-22');
  });

  it('groups owner-facing domains without changing execution status', () => {
    const rows = annotatePortfolioRows([
      { number: 3730, title: '[P1][TIGERIQ LIVE] Project hierarchy', workKind: 'WORK', status: 'REVIEW' },
      { number: 3081, title: '[P1][AUTO-RCA][REVIEW] Repair REVIEW_INDEPENDENCE', workKind: 'WORK', status: 'BLOCKED' },
      { number: 2054, title: '[P4][PAPERCLIP][SHADOW] TigerIQ AI Lab vNext', workKind: 'WORK', status: 'WAITING' },
      { number: 2293, title: '[P5][DEFERRED][REVENUE LAB] PoC Apify Website Audit', workKind: 'WORK', status: 'WAITING' },
    ]);
    expect(rows.map((row) => row.status)).toEqual(['REVIEW','BLOCKED','WAITING','WAITING']);
    expect(new Set(rows.map((row) => row.projectId))).toEqual(new Set(['tigeriq-live','tigeriq-platform','paperclip-vnext','revenue-lab']));
    expect(rows[0].projectName).toBe('TigerIQ Live');
    expect(rows[0].workstreamName).toBe('Giao diện Owner');
    expect(rows[1].projectName).toBe('Nền tảng TigerIQ');
    expect(rows[1].workstreamName).toBe('Auto-RCA & Quan sát');
  });

  it('maps legacy TigerIQ AI Lab project ids to the platform and exposes workstream aliases', () => {
    const rows = annotatePortfolioRows([
      { number: 4260, title: '[P1][CORE][OBSERVABILITY] tcp_probe', workKind: 'WORK', status: 'WAITING' },
    ], [{
      number: 4260,
      title: '[P1][CORE][OBSERVABILITY] tcp_probe',
      body: 'PROJECT_ID=tigeriq-ai-lab\nPROJECT_NAME=TigerIQ AI Lab\nWORK_PACKAGE_ID=core-observability\nWORK_PACKAGE_NAME=Core Observability',
    }]);
    expect(rows[0]).toMatchObject({
      projectId: 'tigeriq-platform',
      projectName: 'Nền tảng TigerIQ',
      projectKind: 'platform',
      workstreamId: 'core-observability',
      workstreamName: 'Core Observability',
      workPackageId: 'core-observability',
    });
  });

  it('prefers canonical WORKSTREAM fields while preserving legacy work-package compatibility', () => {
    const rows = annotatePortfolioRows([
      { number: 9002, title: '[P1] Future job', workKind: 'WORK', status: 'WORKING' },
    ], [{
      number: 9002,
      title: '[P1] Future job',
      body: 'PROJECT_ID=alpha-lab\nPROJECT_NAME=Alpha Lab\nWORKSTREAM_ID=release\nWORKSTREAM_NAME=Phát hành',
    }]);
    expect(rows[0]).toMatchObject({
      projectId: 'alpha-lab',
      workstreamId: 'release',
      workstreamName: 'Phát hành',
      workPackageId: 'release',
      workPackageName: 'Phát hành',
    });
  });


  it('exposes canonical Job ownership, dependencies and next action metadata', () => {
    const rows = annotatePortfolioRows([
      { number: 9003, title: '[P1] Future release', workKind: 'WORK', status: 'WORKING', employeeId: 'NV11' },
    ], [{
      number: 9003,
      title: '[P1] Future release',
      body: [
        'PROJECT_ID=alpha-lab',
        'PROJECT_NAME=Alpha Lab',
        'WORKSTREAM_ID=release',
        'WORKSTREAM_NAME=Phát hành',
        'JOB_ID=ALPHA-42',
        'ASSIGNEE=NV12',
        'DEPENDENCIES=#9001,#9002',
        'NEXT_ACTION=Xác minh bản phát hành',
      ].join('\n'),
    }]);
    expect(rows[0]).toMatchObject({
      jobId: 'ALPHA-42',
      assignee: 'NV12',
      dependencies: [9001, 9002],
      nextAction: 'Xác minh bản phát hành',
    });
  });


  it('separates TigerIQ Live from the platform project', () => {
    const rows = annotatePortfolioRows([
      { number: 4311, title: '[P1][RELEASE][LIVE] Publish Health visual parity', workKind: 'WORK', status: 'WORKING' },
    ]);
    expect(rows[0]).toMatchObject({
      projectId: 'tigeriq-live',
      projectName: 'TigerIQ Live',
      workstreamId: 'release',
      workstreamName: 'Phát hành',
    });
  });
  it('defines seven Owner-approved portfolio groups and five independent TigerIQ AI components', () => {
    expect(CANONICAL_PORTFOLIO_GROUPS.map(group => group.name)).toEqual([
      'TigerIQ AI','TigerIQ News / Media','Paperclip vNext','Revenue Lab',
      'TigerIQ Driver','DeXCam Personal','TigerIQ Coin'
    ]);
    const groups = buildPortfolioGroups([]);
    expect(groups).toHaveLength(7);
    expect(groups[0].projects.map(p => p.name)).toEqual([
      'Nền tảng TigerIQ','TigerIQ Mobile Worker','TigerIQ Live','Workflow Lab','App Chrome'
    ]);
    expect(groups.every(g => g.projects.every(p => p.counts.working === 0))).toBe(true);
  });

  it('keeps legacy project ids and maps DeXCam Personal legacy marker to standalone product', () => {
    const rows = annotatePortfolioRows([
      { number: 4625, title: '[P0][ANDROID/DEX] DeXCam Personal', workKind: 'WORK', status: 'WAITING' },
      { number: 3050, title: '[P1][TIGERIQ NEWS] Editorial', workKind: 'WORK', status: 'WORKING' },
      { number: 4640, title: '[P0][PORTFOLIO] TigerIQ AI', workKind: 'WORK', status: 'WAITING' },
    ], [
      { number: 4625, title: 'DeXCam Personal', body: 'PROJECT_ID=TIGERIQ_DEXCAM_PERSONAL\nPROJECT_NAME=DeXCam Personal' },
      { number: 3050, title: 'TIGERIQ MEDIA', body: 'PROJECT_ID=tigeriq-media\nPROJECT_NAME=TigerIQ Media' },
    ]);
    expect(rows[0]).toMatchObject({ projectId: 'dexcam-personal', projectGroupId: 'dexcam-personal' });
    expect(rows[1]).toMatchObject({ projectId: 'tigeriq-news', projectGroupId: 'tigeriq-news' });
    expect(rows[2].projectId).toBe('tigeriq-platform');
  });

  it('separates DeX Shot under Driver from DeXCam Personal and does not infer from other project prose', () => {
    const rows = annotatePortfolioRows([
      { number: 7001, title: '[DRIVER][ANDROID] DeX Shot companion', workKind: 'WORK', status: 'WAITING' },
      { number: 7002, title: '[DEXCAM] UltraCarVN rebuild', workKind: 'WORK', status: 'WAITING' },
      { number: 7003, title: '[WORKFLOW LAB V5] Read-only portfolio', workKind: 'WORK', status: 'WAITING' },
      { number: 7004, title: '[P1][CORE] Background routing', workKind: 'WORK', status: 'WAITING' },
      { number: 7005, title: '[P2][COIN] Zephyr inventory', workKind: 'WORK', status: 'WAITING' },
    ], [{ number: 7004, title: 'Background routing', body: 'Mention Driver and DeX Shot in unrelated background.' }]);
    expect(rows.map(r => r.projectId)).toEqual([
      'tigeriq-driver','dexcam-personal','tigeriq-workflow-lab','tigeriq-platform','tigeriq-coin'
    ]);
    expect(rows.every(r => r.status === 'WAITING')).toBe(true);
  });

  it('groups work by owner portfolio without changing job status or creating execution claims', () => {
    const rows = annotatePortfolioRows([
      { number: 7001, title: '[DRIVER] Fix manual finance', workKind: 'WORK', status: 'BLOCKED' },
      { number: 7002, title: '[WORKFLOW LAB] Portfolio', workKind: 'WORK', status: 'WAITING' },
    ]);
    const groups = buildPortfolioGroups(buildProjectPortfolio(rows));
    expect(groups).toHaveLength(7);
    expect(groups.find(g => g.id === 'tigeriq-driver').projects[0].counts.blocked).toBe(1);
    expect(groups.find(g => g.id === 'tigeriq-ai').projects.find(p => p.id === 'tigeriq-workflow-lab').counts.waiting).toBe(1);
    expect(groups.find(g => g.id === 'tigeriq-coin').projects[0].presentInWorkSnapshot).toBe(false);
  });


  it('keeps OWNER_GATE blocked without altering the execution state', () => {
    const rows = annotatePortfolioRows([{ number: 8100, title: '[DRIVER] Owner gate', workKind: 'WORK', status: 'OWNER_GATE' }]);
    const driver = buildProjectPortfolio(rows)[0];
    expect(driver.counts).toEqual({ working: 0, review: 0, blocked: 1, waiting: 0, done: 0 });
    expect(rows[0].status).toBe('OWNER_GATE');
  });

  it('inherits project kind and portfolio group across review chains', () => {
    const rows = annotatePortfolioRows([
      { number: 8101, title: '[DRIVER] Fix', workKind: 'WORK', status: 'WORKING' },
      { number: 8102, parentNumber: 8101, title: '[REVIEW] First', reviewOnly: true, workKind: 'WORK', status: 'REVIEW' },
      { number: 8103, parentNumber: 8102, title: '[REVIEW] Second', reviewOnly: true, workKind: 'WORK', status: 'REVIEW' },
    ]);
    for (const row of rows) expect(row).toMatchObject({ projectId: 'tigeriq-driver', projectKind: 'project', projectGroupId: 'tigeriq-driver' });
    const driver = buildPortfolioGroups(buildProjectPortfolio(rows)).find(g => g.id === 'tigeriq-driver');
    expect(driver.projects[0].counts.review).toBe(2);
  });

  it('includes completed-only and active-only work once while current open state wins stale history', () => {
    const open = annotatePortfolioRows([{ number: 8201, title: '[DRIVER] Reopened', workKind: 'WORK', status: 'OWNER_GATE' }]);
    const active = annotatePortfolioRows([
      { number: 8201, title: '[DRIVER] Reopened', workKind: 'WORK', status: 'WORKING' },
      { number: 8202, title: '[DRIVER] Active', workKind: 'WORK', status: 'WORKING' },
    ]);
    const recent = annotatePortfolioRows([
      { number: 8201, title: '[DRIVER] Reopened', workKind: 'WORK', status: 'DONE' },
      { number: 8203, title: '[DRIVER] Complete', workKind: 'WORK', status: 'DONE' },
    ]);
    const rows = mergePortfolioWorkRows(open, active, recent);
    expect(rows).toHaveLength(3);
    const driver = buildProjectPortfolio(rows)[0];
    expect(driver.counts).toEqual({ working: 1, review: 0, blocked: 1, waiting: 0, done: 1 });
    expect(driver.workstreams.reduce((sum, s) => sum + s.itemCount, 0)).toBe(3);
  });

  for (const page of ['projects.html', 'public/projects.html']) {
    it(page + ' renders canonical and custom work including recent DONE without duplicate counts', () => {
      const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');
      const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('async function load()')[0];
      const element = () => ({
        dataset: {}, children: [], _html: '', _text: '',
        set textContent(value) { this._text = String(value); this._html = this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
        get innerHTML() { return this._html; }, set innerHTML(value) { this._html = String(value); },
        append(child) { this.children.push(child); }, replaceChildren() { this.children = []; this._html = ''; },
      });
      const grid = element();
      const context = vm.createContext({ document: { getElementById: () => grid, createElement: element } });
      vm.runInContext(script, context);
      const custom = { number: 8300, title: 'Alpha', projectId: 'alpha-lab', projectName: 'Alpha <Lab>', workKind: 'WORK', status: 'WORKING', workstreamId: 'alpha', workstreamName: 'Release' };
      const driver = annotatePortfolioRows([{ number: 8301, title: '[DRIVER] Gate', workKind: 'WORK', status: 'OWNER_GATE' }])[0];
      const done = annotatePortfolioRows([{ number: 8302, title: '[DRIVER] Finished', workKind: 'WORK', status: 'DONE' }])[0];
      context.data = {
        portfolioGroups: buildPortfolioGroups([]),
        projectPortfolio: buildProjectPortfolio([custom, driver]),
        openWork: [custom, driver],
        activeWork: [{ ...custom, status: 'WORKING' }],
        recentWork: [done],
      };
      vm.runInContext('render(data)', context);
      expect(grid.children).toHaveLength(8);
      const alpha = grid.children.find(card => card.dataset.projectId === 'alpha-lab');
      expect(alpha.innerHTML).toContain('Alpha &lt;Lab&gt;');
      expect(alpha.innerHTML).toContain('Đang làm 1');
      expect(alpha.innerHTML).toContain('1 công việc');
      const card = grid.children.find(item => item.dataset.projectId === 'tigeriq-driver');
      expect(card.innerHTML).toContain('Bị chặn 1');
      expect(card.innerHTML).toContain('Xong 1');
      expect(card.innerHTML).toContain('2 công việc trong nguồn');
    });
  }

});
