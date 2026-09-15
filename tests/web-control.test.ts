import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const web = readFileSync(resolve('apps/tigeriq-core/web-control.html'), 'utf8');
const server = readFileSync(resolve('apps/tigeriq-core/web-control-server.mjs'), 'utf8');
const truth = readFileSync(resolve('apps/tigeriq-core/web-control-truth.js'), 'utf8');
const unified = readFileSync(resolve('apps/tigeriq-core/web-control-unified.js'), 'utf8');
const unifiedCss = readFileSync(resolve('apps/tigeriq-core/web-control-unified.css'), 'utf8');
const launcher = readFileSync(resolve('scripts/tigeriq-core/run-web-control.ps1'), 'utf8');
const apiHealth = readFileSync(resolve('apps/tigeriq-core/dashboard.html'), 'utf8');
const core = readFileSync(resolve('apps/tigeriq-core/core.mjs'), 'utf8');

describe('TigerIQ Web Control owner dashboard', () => {
  it('uses API Health as the visual/function reference without iframe duplication', () => {
    expect(apiHealth).toContain('<title>TigerIQ API Health</title>');
    expect(core).toContain('dashboard()');
    expect(server).toContain('web-control-unified.js');
    expect(server).toContain('web-control-unified.css');
    expect(unified).toContain('API Health is the visual/function reference');
    expect(web + unified).not.toMatch(/<iframe\b/i);
  });

  it('ports API Health live UI affordances into Web Control', () => {
    for (const label of ['API/NV online','NV đang bận','Cảnh báo','Chờ cấu hình key','Jobs đang chạy','Tỷ lệ thành công','Độ trễ trung bình','Uptime','Hiệu suất API','Công việc gần nhất','Cloud API','Có vấn đề']) {
      expect(unified).toContain(label);
    }
    expect(unified).toContain('PROVIDER_MARK');
    expect(unified).toContain('tq-logo');
    expect(unified).toContain('tq-spark');
    expect(unified).toContain('LIVE · 2s');
    expect(web).toContain('setInterval(refresh,2000)');
  });

  it('uses the approved system font and monospace stacks', () => {
    expect(unifiedCss).toContain('--tq-font:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif');
    expect(unifiedCss).toContain('font-size:14px!important;line-height:1.5!important');
    expect(unifiedCss).toContain('-webkit-font-smoothing:antialiased');
    expect(unifiedCss).toContain('-moz-osx-font-smoothing:grayscale');
    expect(unifiedCss).toContain('--tq-mono:"SFMono-Regular",Consolas,"Roboto Mono","Liberation Mono",Menlo,monospace');
    expect(unifiedCss).toContain('code,pre,.terminal-log');
    expect(unifiedCss).toContain('font-size:13px!important');
  });

  it('uses runtime truth and keeps Coding Lane stages without fake progress', () => {
    expect(web).toContain("fetch('/api/status'");
    expect(server).toContain('codingLane');
    expect(server).toContain('TIGERIQ_CODING_LANE_URL');
    expect(truth).toContain("['Intake'");
    expect(truth).toContain("['Review'");
    expect(truth).toContain("['CI'");
    expect(truth).toContain('reviewer_employee_id');
    expect(truth).toContain('Không bịa %');
    expect(unified).toContain('calls_success_24h');
    expect(unified).toContain('last_latency_ms');
    expect(unified).toContain('last_error');
    expect(unified).toContain('cooldown_until');
  });

  it('keeps responsive desktop/tablet/mobile breakpoints', () => {
    expect(unifiedCss).toContain('@media(max-width:1450px)');
    expect(unifiedCss).toContain('@media(max-width:1050px)');
    expect(unifiedCss).toContain('@media(max-width:720px)');
    expect(unifiedCss).toContain('@media(max-width:460px)');
  });

  it('runs as the read-only Web Control service', () => {
    expect(server).toContain("TIGERIQ_WEB_CONTROL_PORT || 8796");
    expect(server).toContain("url.pathname === '/api/status'");
    expect(server).toContain("url.pathname === '/health'");
    expect(server).toContain("url.pathname === '/web-control-unified.js'");
    expect(server).toContain("url.pathname === '/web-control-unified.css'");
    expect(server).not.toMatch(/req\.method\s*===\s*['\"]POST['\"]/);
    expect(server).not.toMatch(/req\.method\s*===\s*['\"]DELETE['\"]/);
    expect(launcher).toContain("$env:TIGERIQ_WEB_CONTROL_PORT='8796'");
  });

  it('does not expose destructive or credential controls', () => {
    expect(web).not.toMatch(/type=["']password["']/i);
    expect(web).not.toMatch(/delete credential|reboot|shutdown/i);
    expect(web).toContain('Chỉ đọc');
  });
});
