import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ Live real workflow graph #3231', () => {
  it('keeps root and public TigerIQ Live in sync', () => {
    expect(publicHtml).toBe(rootHtml);
  });

  it('replaces the fixed six-step journey with a real workflow graph', () => {
    expect(rootHtml).toContain('LUỒNG CÔNG VIỆC');
    expect(rootHtml).toContain('function buildWorkflowGraph()');
    expect(rootHtml).toContain('function workflowResolveRoot(seed,rows)');
    expect(rootHtml).toContain('function workflowCluster(root,focus,rows)');
    expect(rootHtml).not.toContain('function journeyStageState');
    expect(rootHtml).not.toContain('const stages=[');
    expect(rootHtml).not.toContain('.journey-stage');
  });

  it('keeps the active focus corridor visible before adding optional siblings', () => {
    expect(rootHtml).toContain('function workflowAncestorPath(focus,rows)');
    expect(rootHtml).toContain('const path=workflowAncestorPath(focus,rows)');
    expect(rootHtml).toContain('path.forEach(add)');
    expect(rootHtml).toContain('const remaining=()=>Math.max(0,10-selected.length)');
    expect(rootHtml).toContain('workflowCluster(root,seed,rows)');
    expect(rootHtml).toContain("!superseded.has(Number(row.number))");
  });

  it('builds nodes only from actual work items, PRs and check data', () => {
    expect(rootHtml).toContain("const pr=Number(row?.prNumber||row?.targetPrNumber||row?.sourcePrNumber)");
    expect(rootHtml).toContain("addNode({id:prId,type:'pr'");
    expect(rootHtml).toContain("if(row?.checks)");
    expect(rootHtml).toContain("addNode({id:checkId,type:'checks'");
    expect(rootHtml).toContain("row?.parentNumber");
    expect(rootHtml).toContain("row?.dependsOn");
    expect(rootHtml).toContain("row?.supersedesNumbers");
  });

  it('renders true branching and draws edges from the graph relation set', () => {
    expect(rootHtml).toContain("addEdge(prId,id,workStatus(row),'target-pr')");
    expect(rootHtml).toContain("addEdge(parentId,id,workStatus(row),'parent')");
    expect(rootHtml).toContain("addEdge(depId,id,workStatus(row),'dependency')");
    expect(rootHtml).toContain('function drawWorkflowEdges()');
    expect(rootHtml).toContain('workflow-wires');
  });

  it('renders visible motion for real workflow states without changing state semantics', () => {
    expect(rootHtml).toContain('workflow-particle');
    expect(rootHtml).toContain('<animateMotion');
    expect(rootHtml).toContain('@keyframes workflow-wire-review-flow');
    expect(rootHtml).toContain('@keyframes workflow-wire-wait-flow');
    expect(rootHtml).toContain('@keyframes workflow-blocked-node');
    expect(rootHtml).toContain('@keyframes workflow-focus-ring');
    expect(rootHtml).toContain("if(s==='WAITING')return 'is-waiting'");
    expect(rootHtml).toContain("if(s==='QUEUED')return 'is-queued'");
    expect(rootHtml).toContain("const isFocus=node.id==='issue-'+Number(workflowGraphState?.focus?.number)");
  });

  it('shows live animation without pretending stale data is live', () => {
    expect(rootHtml).toContain('@keyframes workflow-wire-flow');
    expect(rootHtml).toContain('@keyframes workflow-node-pulse');
    expect(rootHtml).toContain('@keyframes workflow-ambient');
    expect(rootHtml).toContain('.workflow-wire.is-working');
    expect(rootHtml).toContain("const fresh=!(snapshot?.staleAll||snapshot?.workProjection?.stale)");
    expect(rootHtml).toContain('Dữ liệu hiện tại đã cũ nên chưa dựng luồng để tránh hiển thị sai.');
    expect(rootHtml).toContain('@media(prefers-reduced-motion:reduce)');
    expect(rootHtml).toContain('.workflow-particle{display:none!important}');
  });

  it('keeps mobile layout compact and node details interactive', () => {
    expect(rootHtml).toContain('@media(max-width:700px)');
    expect(rootHtml).toContain('grid-template-columns:repeat(auto-fit,minmax(138px,1fr))');
    expect(rootHtml).toContain('data-row-number');
    expect(rootHtml).toContain('openDrawer(row,node)');
    expect(rootHtml).toContain("target=\"_blank\" rel=\"noopener noreferrer\"");
  });

  it('preserves existing owner dashboard, list and drawer', () => {
    for (const id of ['ownerSummary','workList','workDrawer','nowRunning','apiWorkforce']) {
      expect(rootHtml).toContain('id="'+id+'"');
    }
  });
});
