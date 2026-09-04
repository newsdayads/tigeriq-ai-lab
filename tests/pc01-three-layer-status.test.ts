import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const paths = ['public/index.html', 'public/command-center.html', 'command-center.html'];
const htmlByPath = new Map(paths.map((path) => [path, readFileSync(path, 'utf8')]));
const html = htmlByPath.get('public/index.html')!;

describe('#338 PC01 three-layer Web Control', () => {
  it('separates Server, Control Plane, and AI PC01 in the active UI', () => {
    expect(html).toContain('1. PC01 SERVER');
    expect(html).toContain('2. TIGERIQ CONTROL PLANE');
    expect(html).toContain('3. AI PC01 — NV-SYS-01');
    expect(html).toContain('Không có host telemetry');
    expect(html).toContain('không phải machine health');
  });

  it('fails closed for missing telemetry and degrades Control Plane when Controller fails', () => {
    expect(html).toContain("controller==='failed'");
    expect(html).toContain("$('controlPlaneState').textContent='SUY GIẢM'");
    expect(html).toContain("setChip($('chipControl'),'Control Plane SUY GIẢM','bad')");
    expect(html).toContain("$('serverState').textContent='CHƯA XÁC MINH'");
    expect(html).not.toContain("healthy=(pc==='online'||pc==='working')&&gh==='online'");
  });

  it('does not mark AI PC01 active merely because Ollama/model inventory exists', () => {
    expect(html).toContain("$('aiPc01State').textContent='CHƯA XÁC MINH'");
    expect(html).toContain("$('aiJob').textContent='Không có evidence job'");
    expect(html).toContain('Model/Ollama tồn tại chỉ là capability inventory; không được coi là AI đang hoạt động.');
    expect(html).not.toContain("s?.execution?.ollama==='online'?'Online'");
  });

  it('keeps all Command Center artifacts identical and leaves Khoa verifier out of scope', () => {
    expect(htmlByPath.get('public/command-center.html')).toBe(html);
    expect(htmlByPath.get('command-center.html')).toBe(html);
    expect(paths).not.toContain('scripts/verify_work_board_ui.mjs');
  });

  it('preserves current auth, queue, progress, and dispatch contracts', () => {
    expect(html).toContain('/api/owner-auth?action=status');
    expect(html).toContain("operation:'status'");
    expect(html).toContain("operation:'work-board'");
    expect(html).toContain("operation:'work-order'");
    expect(html).toContain('/api/company-progress');
    expect(html).toContain('/api/workforce-status');
    expect(html).toContain('id="instruction"');
    expect(html).toContain('id="dispatch"');
    expect(html).toContain('id="progressPct"');
  });
});
