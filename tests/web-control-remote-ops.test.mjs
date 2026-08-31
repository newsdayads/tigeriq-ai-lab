import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ui = readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');
const statusApi = readFileSync(new URL('../api/web-control-status.mjs', import.meta.url), 'utf8');
const ownerAuth = readFileSync(new URL('../api/owner-auth.mjs', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');

describe('WO-045 Web Control remote operations', () => {
  it('keeps the executive Web Control as the primary root entry including after Owner login', () => {
    expect(vercel).toContain('"source": "/", "destination": "/command-center.html"');
    expect(ui).toContain('TigerIQ · Web Control');
    expect(ui).toContain('/api/web-control-status');
    expect(ownerAuth).toContain("return redirect(res, '/?owner=connected')");
    expect(ownerAuth).not.toContain("return redirect(res, '/index.html?owner=connected')");
  });

  it('supports Owner-authenticated gated dispatch without browser credentials', () => {
    expect(ui).toContain('/api/owner-auth?action=login');
    expect(ui).toContain("operation:'work-order'");
    expect(ui).toContain("operation:'canary'");
    expect(ui).toContain('Lệnh tạo Work Order, không chạy shell trực tiếp.');
    expect(ui).not.toContain('githubToken');
    expect(ui).not.toContain('github_pat_');
    expect(ui).not.toContain('x-tigeriq-secret');
    expect(ui).not.toContain('TIGERIQ_COMMAND_SECRET');
  });

  it('fails closed unless Owner auth and server-side GitHub write are both ready', () => {
    expect(statusApi).toContain('authenticated: ownerAuthenticated');
    expect(statusApi).toContain('serverWriteConfigured: Boolean(GITHUB_TOKEN)');
    expect(statusApi).toContain('writeReady: Boolean(ownerAuthenticated && GITHUB_TOKEN)');
    expect(ui).toContain("$('dispatchBtn').disabled=!owner.writeReady||busy");
    expect(ui).toContain("$('canaryBtn').disabled=!owner.writeReady||busy");
  });

  it('separates PC01 execution evidence from physical-device assumptions', () => {
    expect(statusApi).toContain("physicalState: 'unknown'");
    expect(statusApi).toContain('chưa có CLAIM/RESULT');
    expect(ui).toContain('Trạng thái vật lý PC01');
    expect(ui).toContain('KHÔNG SUY ĐOÁN');
    expect(ui).toContain('REVIEW PASS');
    expect(ui).toContain('JUDGE PASS');
  });

  it('uses server-side GitHub credentials only for read/write plumbing and never returns them', () => {
    expect(statusApi).toContain("const GITHUB_TOKEN = String(process.env.TIGERIQ_GITHUB_TOKEN || '').trim()");
    expect(statusApi).toContain('headers.authorization = `Bearer ${GITHUB_TOKEN}`');
    expect(statusApi).not.toMatch(/GITHUB_TOKEN\s*[,}]/);
  });
});
