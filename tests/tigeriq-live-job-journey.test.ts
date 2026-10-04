import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const rootHtml = fs.readFileSync(new URL('../command-center.html', import.meta.url), 'utf8');
const publicHtml = fs.readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');

describe('TigerIQ Live restored Work Package cards #3576', () => {
  it('keeps root and public exactly in sync', () => {
    expect(publicHtml).toBe(rootHtml);
  });

  it('restores the proven Work Package v2 hierarchy as the primary Owner surface', () => {
    expect(rootHtml).toContain("el.innerHTML='<article class=\"package-shell\">'");
    expect(rootHtml).toContain('function packageStreamHtml(stream,packageFocus)');
    expect(rootHtml).toContain('function packageTaskHtml(group,packageFocus)');
    expect(rootHtml).toContain('VIỆC LỚN · #');
    expect(rootHtml).toContain('NHÁNH CÔNG VIỆC');
    expect(rootHtml).toContain('Đang ở #');
    expect(rootHtml).not.toContain('const mobileCompact=');
  });

  it('keeps review/PR/CI as evidence rather than equal work nodes', () => {
    expect(rootHtml).toContain('function packageIsReviewEvidence(row)');
    expect(rootHtml).toContain('Rà soát/evidence đã gom:');
    expect(rootHtml).toContain('package-artifact');
  });

  it('renders dependency motion only from explicit dependsOn data', () => {
    expect(rootHtml).toContain('function packageDependencyLinks(streams)');
    expect(rootHtml).toContain('(target.root?.dependsOn||[]).map(Number)');
    expect(rootHtml).toContain('package-dep-particle');
  });

  it('adds a progress bar to every old work card without inventing percentages', () => {
    expect(rootHtml).toContain('const worker=workerFrom(focus),artifacts=group.artifacts,progress=verifiedProgress(focus);');
    expect(rootHtml).toContain('class="package-task-progress"');
    expect(rootHtml).toContain('class="package-task-progress-track" role="progressbar"');
    expect(rootHtml).toContain("aria-valuenow=\"'+progress.pct+'\"");
    expect(rootHtml).toContain("'<b>'+progress.pct+'%</b>");
    expect(rootHtml).toContain('chưa xác minh');
    expect(rootHtml).toContain('progress.verified');
  });

  it('uses only verified progress sources for percentage values', () => {
    expect(rootHtml).toContain('function verifiedProgress(row)');
    expect(rootHtml).toContain("['explicit_verified','checklist_verified','terminal']");
    expect(rootHtml).toContain('Number.isFinite(pct)');
  });

  it('keeps package cards mobile-first and raw technical jobs collapsed', () => {
    expect(rootHtml).toContain('@media(max-width:700px){.package-shell');
    expect(rootHtml).toContain('.package-streams{grid-template-columns:1fr}');
    expect(rootHtml).toContain('<details id="rawWorkDetails" class="raw-work-details">');
    expect(rootHtml).not.toContain('<details id="rawWorkDetails" class="raw-work-details" open');
  });
});
