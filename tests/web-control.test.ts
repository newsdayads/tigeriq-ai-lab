import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const web = readFileSync(resolve('apps/tigeriq-core/web-control.html'), 'utf8');
const server = readFileSync(resolve('apps/tigeriq-core/web-control-server.mjs'), 'utf8');
const launcher = readFileSync(resolve('scripts/tigeriq-core/run-web-control.ps1'), 'utf8');
const apiHealth = readFileSync(resolve('apps/tigeriq-core/dashboard.html'), 'utf8');
const core = readFileSync(resolve('apps/tigeriq-core/core.mjs'), 'utf8');

describe('TigerIQ Web Control isolation', () => {
  it('keeps API Health as a separate existing product', () => {
    expect(apiHealth).toContain('<title>TigerIQ API Health</title>');
    expect(core).toContain("url.pathname==='/'");
    expect(core).toContain('return res.end(dashboard())');
    expect(core).not.toContain('web-control-server.mjs');
  });

  it('contains the approved Web Control information architecture', () => {
    expect(web).toContain('<title>TigerIQ Core 24/7 — Web Control</title>');
    for (const label of [
      'Tổng quan', 'Nhân sự AI', 'Công việc', 'Mục tiêu', 'Lịch sử',
      'Giám sát hệ thống', 'Cài đặt', 'Sơ đồ nhân sự AI', 'Job Pipeline',
      'Objective / Công việc chính', 'Bảng nhân sự AI', 'Cảnh báo & Sự kiện gần đây'
    ]) expect(web).toContain(label);
  });

  it('uses Core status data rather than hard-coded resource/job/objective truth', () => {
    expect(web).toContain("fetch('/api/status'");
    expect(web).toContain('d.resources');
    expect(web).toContain('d.jobs');
    expect(web).toContain('d.objectives');
    expect(web).toContain('d.events');
    expect(web).toContain('Mất kết nối Web Control');
  });

  it('has responsive breakpoints for desktop, tablet and phone', () => {
    expect(web).toContain('@media(max-width:1500px)');
    expect(web).toContain('@media(max-width:1150px)');
    expect(web).toContain('@media(max-width:760px)');
    expect(web).toContain('@media(max-width:480px)');
  });

  it('runs as a separate read-only service and proxies only Core reads', () => {
    expect(server).toContain("TIGERIQ_WEB_CONTROL_PORT || 8796");
    expect(server).toContain("url.pathname === '/api/status'");
    expect(server).toContain("url.pathname === '/health'");
    expect(server).not.toMatch(/req\.method\s*===\s*['\"]POST['\"]/);
    expect(server).not.toMatch(/req\.method\s*===\s*['\"]DELETE['\"]/);
    expect(launcher).toContain("$env:TIGERIQ_WEB_CONTROL_PORT='8796'");
    expect(launcher).toContain("$env:TIGERIQ_CORE_URL=('http://'+$hostIp+':8795')");
  });

  it('does not expose destructive or credential controls', () => {
    expect(web).not.toMatch(/type=["']password["']/i);
    expect(web).not.toMatch(/delete credential|reboot|shutdown/i);
    expect(web).toContain('Chỉ đọc');
  });
});
