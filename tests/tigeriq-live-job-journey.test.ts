import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ Live work-package hierarchy #3324', () => {
  it('keeps root and public TigerIQ Live in sync', () => {
    expect(publicHtml).toBe(rootHtml);
  });

  it('renders one big work package instead of an issue-centric graph', () => {
    expect(rootHtml).toContain('VIỆC LỚN · #');
    expect(rootHtml).toContain('NHÁNH CÔNG VIỆC');
    expect(rootHtml).toContain('function buildWorkPackage()');
    expect(rootHtml).toContain('function packageBranchRoot(row,root,byNumber)');
    expect(rootHtml).not.toContain('function buildWorkflowGraph()');
    expect(rootHtml).not.toContain('workflow-particle');
    expect(rootHtml).not.toContain('workflow-wires');
  });

  it('derives package, workstream and task hierarchy from real parent relations', () => {
    expect(rootHtml).toContain('function packageResolveRoot(seed,rows)');
    expect(rootHtml).toContain('function packageDescendants(root,rows)');
    expect(rootHtml).toContain('const streamRoot=packageBranchRoot(row,root,byNumber)');
    expect(rootHtml).toContain('Number(row.parentNumber)');
  });

  it('keeps PR and checks as compact evidence inside a task instead of peer nodes', () => {
    expect(rootHtml).toContain('function packageArtifacts(row)');
    expect(rootHtml).toContain("out.push({label:'PR #'+pr");
    expect(rootHtml).toContain("out.push({label,url:pr?");
    expect(rootHtml).toContain('package-artifact');
  });

  it('keeps focus visible and prioritizes active work over completed history', () => {
    expect(rootHtml).toContain('function packageVisibleTasks(stream,focus)');
    expect(rootHtml).toContain("const active=ordered.filter(row=>workStatus(row)!=='DONE')");
    expect(rootHtml).toContain("const done=ordered.filter(row=>workStatus(row)==='DONE').slice(0,2)");
    expect(rootHtml).toContain("Number(row.number)===Number(focus?.number)");
  });

  it('shows true dependency text between workstreams and does not invent percentages', () => {
    expect(rootHtml).toContain('function packageDependencyText(stream,streams)');
    expect(rootHtml).toContain('Phụ thuộc: ');
    expect(rootHtml).not.toContain('verifiedProgress(focus)');
    expect(rootHtml).not.toContain('workflow-progress-fill');
  });

  it('summarizes real task states for the big work package', () => {
    for (const text of ['Đang làm','Rà soát','Bị chặn','Đang chờ','Hoàn tất']) {
      expect(rootHtml).toContain(text);
    }
    expect(rootHtml).toContain('function packageStats(rows)');
  });

  it('keeps motion state-derived and reduced-motion safe', () => {
    expect(rootHtml).toContain('@keyframes package-focus-pulse');
    expect(rootHtml).toContain('@keyframes package-review-pulse');
    expect(rootHtml).toContain('@keyframes package-blocked-pulse');
    expect(rootHtml).toContain('@media(prefers-reduced-motion:reduce)');
  });

  it('preserves the existing owner dashboard, list and drawer', () => {
    for (const id of ['ownerSummary','workList','workDrawer','nowRunning','apiWorkforce']) {
      expect(rootHtml).toContain('id="'+id+'"');
    }
  });
});
