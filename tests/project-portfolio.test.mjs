import { describe, expect, it } from 'vitest';
import { annotatePortfolioRows, buildProjectPortfolio, classifyProject } from '../apps/tigeriq-core/project-portfolio.mjs';

describe('TigerIQ LIVE project portfolio', () => {
  it('uses explicit project fields for future projects', () => {
    const project = classifyProject({ number: 9001, title: '[P2] Future product' }, {
      number: 9001,
      title: '[P2] Future product',
      body: 'PROJECT_ID=alpha-lab\nPROJECT_NAME=Alpha Lab',
    });
    expect(project).toEqual({ id: 'alpha-lab', name: 'Alpha Lab', order: 900 });
  });

  it('maps historical TigerIQ Media naming to canonical TigerIQ News', () => {
    const rows = annotatePortfolioRows([{ number: 3033, title: '[P1][TIGERIQ MEDIA][SECURITY] Admin auth', workKind: 'WORK', status: 'WORKING' }]);
    expect(rows[0].projectId).toBe('tigeriq-news');
    expect(rows[0].projectName).toBe('TigerIQ News');
  });

  it('collapses current Android work by title version and ignores unrelated body version markers', () => {
    const issues = [
      { number: 2949, title: '[P3][ANDROID] TigerIQ Mobile Worker', body: 'REGISTRY=registry-335-live|v53|stale=false\nCURRENT_TARGET=v0.21' },
      { number: 3683, title: '[P1][ANDROID][LIVE] v0.22 Live Worker', body: '' },
      { number: 3710, title: '[P1][ANDROID][LIVE] v0.22 Live Worker — Core dispatch', body: '' },
      { number: 3597, title: '[P1][ANDROID] v0.21 release review', body: '' },
    ];
    const rows = annotatePortfolioRows([
      { number: 2949, title: '[P3][ANDROID] TigerIQ Mobile Worker', workKind: 'WORK', status: 'WAITING' },
      { number: 3683, parentNumber: 2949, title: '[P1][ANDROID][LIVE] v0.22 Live Worker', workKind: 'WORK', status: 'WORKING' },
      { number: 3710, title: '[P1][ANDROID][LIVE] v0.22 Live Worker — Core dispatch', workKind: 'WORK', status: 'WAITING' },
      { number: 3597, title: '[P1][ANDROID] v0.21 release review', workKind: 'WORK', status: 'WAITING' },
    ], issues);
    expect(rows.find((row) => row.number === 2949)?.workPackageId).toBe('mobile-v0-22');
    expect(rows.find((row) => row.number === 3683)?.workPackageId).toBe('mobile-v0-22');
    expect(rows.find((row) => row.number === 3710)?.workPackageId).toBe('mobile-v0-22');
    expect(rows.find((row) => row.number === 3597)?.portfolioHidden).toBe(true);
    const projects = buildProjectPortfolio(rows);
    const mobile = projects.find((project) => project.id === 'tigeriq-mobile-worker');
    expect(mobile.workPackageCount).toBe(1);
    expect(mobile.workPackages[0].name).toBe('Live Worker v0.22');
    expect(mobile.hiddenTechnicalItems).toBe(1);
  });

  it('does not misclassify governance issues from Android/version text in their bodies', () => {
    const issues = [{
      number: 504,
      title: '[P0][QUẢN TRỊ] Chính sách tương tác',
      body: 'REGISTRY=registry-335-live|v51|stale=false\nANDROID_WORKER_DRIVE_STORAGE_V1=true\nAPP_CHROME_COMMAND_V6=true',
    }];
    const rows = annotatePortfolioRows([
      { number: 504, title: '[P0][QUẢN TRỊ] Chính sách tương tác', workKind: 'WORK', status: 'WAITING' },
    ], issues);
    expect(rows[0].projectId).toBe('tigeriq-ai-lab');
    expect(rows[0].androidVersionMinor).toBeNull();
  });

  it('inherits parent work package for review evidence without collapsing versioned Android work', () => {
    const rows = annotatePortfolioRows([
      { number: 3730, title: '[P1][TIGERIQ LIVE] Project hierarchy', workKind: 'WORK', status: 'WORKING' },
      { number: 3753, parentNumber: 3730, title: '[P1][REVIEW][NV11] PR #3742 exact-head', workKind: 'WORK', status: 'REVIEW', reviewOnly: true },
      { number: 2949, title: '[P3][ANDROID] Mobile Worker v0.21', workKind: 'WORK', status: 'WAITING' },
      { number: 3683, parentNumber: 2949, title: '[P1][ANDROID][LIVE] v0.22 Live Worker', workKind: 'WORK', status: 'WORKING' },
    ]);
    expect(rows.find((row) => row.number === 3753)?.workPackageId).toBe('live-ui');
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
    expect(new Set(rows.map((row) => row.projectId))).toEqual(new Set(['tigeriq-ai-lab','paperclip-vnext','revenue-lab']));
    expect(rows[0].workPackageName).toBe('TigerIQ LIVE');
    expect(rows[1].workPackageName).toBe('Auto-RCA & Observability');
  });
});
