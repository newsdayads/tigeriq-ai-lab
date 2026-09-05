import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ServerTelemetry } from '../apps/dashboard/src/server.js';
import { controlPlaneState, injectLocalP0Panel, renderLocalP0Panel } from '../apps/dashboard/src/server-v6.js';

function telemetry(controller: ServerTelemetry['controller'], available = true): ServerTelemetry {
  return {
    available,
    server: 'PC01',
    generatedAt: '2026-09-05T01:00:00.000Z',
    cpu: null,
    memory: null,
    uptimeSeconds: 7200,
    disk: null,
    worker: { online: true, pid: 123, instances: 1 },
    controller,
    workforce: {
      employeesTotal: 1,
      idle: 0,
      busy: 1,
      offline: 0,
      degraded: 0,
      activeTasks: 1,
      tasksActive: 1,
      tasksFailed: 0,
      roster: [{
        employeeId: 'NV03', displayName: 'Huy', department: 'AI PC01', role: 'Kỹ sư Hệ thống Local', nodeId: 'pc01', provider: 'ollama', model: 'qwen3:8b', availability: 'busy', healthScore: 100, concurrencyLimit: 1, activeTaskCount: 1, currentTaskIds: ['#372'],
      }],
    },
    postgresql: { online: true, service: 'postgresql', port: 5432 },
    ollama: { online: true, models: ['qwen3:8b'] },
    tailscale: { online: true, ip: '100.97.23.87' },
    gpu: null,
  };
}

const governance = {
  issue338: { number: 338, state: 'open', body: '## Mục tiêu\nTách Web Local thành ba lớp thật.\n\nOWNER_HOLD=true' },
  latest338: { body: 'TIGERIQ_JOB_PROGRESS\nstate=ĐANG_XỬ_LÝ_WEB_LOCAL' },
  central: { number: 280, state: 'open', body: 'Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local) tạm ngưng' },
  registry: { number: 335, state: 'open', body: '`3` | `NV03` | specialized | LOCAL_SYSTEM_FIRST | pc01_local_specialist | Huy | false — TẠM NGƯNG\nNV03 active=false (TẠM NGƯNG)' },
  installedSha: '0123456789abcdef0123456789abcdef01234567',
};

describe('Web Local #338 overlay', () => {
  it('maps an explicit Controller failure to SUY GIẢM instead of unknown/green', () => {
    const state = controlPlaneState(telemetry({ online: false, ip: '127.0.0.1', port: 8790 }));
    expect(state.label).toContain('SUY GIẢM');
    expect(state.css).toBe('bad');
  });

  it('keeps missing Controller telemetry fail-closed as CHƯA XÁC MINH', () => {
    const state = controlPlaneState(telemetry(null));
    expect(state.label).toBe('CHƯA XÁC MINH');
    expect(state.css).toBe('wait');
  });

  it('renders all canonical identities, three layers, executive chain and build evidence', () => {
    const panel = renderLocalP0Panel(telemetry({ online: true, ip: '127.0.0.1', port: 8790 }), governance, new Date('2026-09-05T01:00:00.000Z'));
    for (const expected of ['Vy (Trợ lý)','Minh (NV01 — Thực thi trực tiếp)','Khoa (NV02 — Vận hành tự động)','Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)','TẠM NGƯNG','PC01 SERVER','TIGERIQ CONTROL PLANE','AI PC01 — HUY/NV03','MỤC TIÊU','HẠNG MỤC','BƯỚC HIỆN TẠI','MỐC KẾ TIẾP','NGƯỜI PHỤ TRÁCH','WEB-LOCAL-338-V2','0123456789ab']) expect(panel).toContain(expected);
  });

  it('owner pause overrides stale busy telemetry for Huy', () => {
    const panel = renderLocalP0Panel(telemetry({ online: true, ip: '127.0.0.1', port: 8790 }), governance, new Date('2026-09-05T01:00:00.000Z'));
    expect(panel).toContain('TẠM NGƯNG');
    expect(panel).not.toContain('Có task runtime');
  });

  it('injects the panel after the existing header without deleting V5 content', () => {
    const html = '<html><body><header>V5</header><main>legacy-body</main></body></html>';
    const out = injectLocalP0Panel(html, '<section id="overlay">P0</section>', telemetry({ online: false, ip: null, port: 8790 }));
    expect(out).toContain('</header><section id="overlay">P0</section><main>legacy-body</main>');
  });

  it('emits bounded exact runtime evidence only after updater pointer/state, live health and rendered UI agree', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    for (const expected of [
      'TIGERIQ_WEB_LOCAL_RUNTIME_EVIDENCE',
      "state.result === 'UPDATED' || state.result === 'NO_CHANGE'",
      'pointerSha !== sourceSha',
      "String(state.installedSha ?? '').toLowerCase() !== sourceSha",
      'fetch(`${serverUrl}/api/status`',
      'fetch(`${serverUrl}/`',
      'LIVE_UI_MARKERS.filter',
      'ui_required_markers=${LIVE_UI_MARKERS.length}/${LIVE_UI_MARKERS.length}',
      'live_ui_contract=ĐẠT',
      'state=WEB_LOCAL_RUNTIME_AND_UI_VERIFIED',
      'current_release_match=true',
      'candidate_and_live_health=ĐẠT',
      "host === '127.0.0.1'",
      'attempt < 30',
    ]) expect(standalone).toContain(expected);
  });
});
