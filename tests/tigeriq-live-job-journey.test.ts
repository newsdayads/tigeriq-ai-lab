import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ Live work-package hierarchy v2 #3374', () => {
  it('keeps root and public TigerIQ Live in sync', () => {
    expect(publicHtml).toBe(rootHtml);
  });

  it('groups live work as package -> workstream -> major task -> current leaf', () => {
    expect(rootHtml).toContain('function packageBuildAll()');
    expect(rootHtml).toContain('function packageStream(streamRoot,packageRows,byNumber)');
    expect(rootHtml).toContain('function packageTaskGroup(taskRoot,allRows,byNumber)');
    expect(rootHtml).toContain('Đang ở #');
    expect(rootHtml).not.toContain('function buildWorkflowGraph()');
  });

  it('keeps review-only jobs as evidence instead of workstreams or primary tasks', () => {
    expect(rootHtml).toContain('function packageIsReviewEvidence(row)');
    expect(rootHtml).toContain("row?.reviewOnly===true");
    expect(rootHtml).toContain("!packageIsReviewEvidence(row)");
    expect(rootHtml).toContain('Rà soát/evidence đã gom:');
  });

  it('chooses an operational descendant focus instead of package root when possible', () => {
    expect(rootHtml).toContain('function packageOperationalFocus(rows)');
    expect(rootHtml).toContain('const descendants=primary.filter(row=>Number(row.parentNumber))');
    expect(rootHtml).toContain('const candidates=descendants.length?descendants:primary');
    expect(rootHtml).toContain("BLOCKED:1");
  });

  it('renders dependency motion only from explicit DEPENDS_ON relations', () => {
    expect(rootHtml).toContain('function packageDependencyLinks(streams)');
    expect(rootHtml).toContain("(target.root?.dependsOn||[]).map(Number)");
    expect(rootHtml).toContain('package-dep-particle');
    expect(rootHtml).not.toContain('function packageFlowHtml');
    expect(rootHtml).not.toContain('package-flow-arrow');
  });

  it('shows visible state-derived live motion without inventing workflow state', () => {
    expect(rootHtml).toContain('package-livebar');
    expect(rootHtml).toContain('@keyframes package-livebar');
    expect(rootHtml).toContain('@keyframes package-dep-run');
    expect(rootHtml).toContain('@keyframes package-dep-blocked');
    expect(rootHtml).toContain('@media(prefers-reduced-motion:reduce)');
  });

  it('aggregates stream/task state from primary descendants rather than root status alone', () => {
    expect(rootHtml).toContain('function packageAggregate(rows)');
    expect(rootHtml).toContain("if(open.some(row=>workStatus(row)==='BLOCKED'))state='BLOCKED'");
    expect(rootHtml).toContain('stream.aggregate.label');
    expect(rootHtml).toContain('group.aggregate.label');
  });

  it('summarizes major task groups rather than counting review artifacts as jobs', () => {
    expect(rootHtml).toContain('const majorGroups=streams.flatMap(stream=>stream.groups)');
    expect(rootHtml).toContain('function packageSummaryFromGroups(groups)');
    expect(rootHtml).toContain("pack.majorGroups.length+' việc chính'");
  });

  it('offers multiple work packages and collapses the raw technical job list by default', () => {
    expect(rootHtml).toContain('function packageTabsHtml(packages,selected)');
    expect(rootHtml).toContain('data-package-select');
    expect(rootHtml).toContain('<details id="rawWorkDetails" class="raw-work-details">');
    expect(rootHtml).toContain('JOB kỹ thuật / chi tiết hệ thống');
  });

  it('preserves the existing owner dashboard, raw list and drawer', () => {
    for (const id of ['ownerSummary','workList','workDrawer','nowRunning','apiWorkforce']) {
      expect(rootHtml).toContain('id="'+id+'"');
    }
  });
});
