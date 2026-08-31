import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deployedEntry = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');
const statusApi = readFileSync(new URL('../api/web-control-status.mjs', import.meta.url), 'utf8');
const ownerAuth = readFileSync(new URL('../api/owner-auth.mjs', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');

describe('WO-045 Web Control remote operations', () => {
  it('keeps the actually deployed root entry on the secure TigerIQ AI Web Control including after Owner login', () => {
    expect(vercel).toContain('"source": "/", "destination": "/command-center.html"');
    expect(deployedEntry).toContain("location.replace('/command-center')");
    expect(deployedEntry).toContain('url=/command-center');
    expect(deployedEntry).not.toContain('githubToken');
    expect(deployedEntry).not.toContain('github_pat_');
    expect(ui).toContain('TigerIQ AI · Web Control');
    expect(ui).toContain('🐯 TigerIQ AI');
    expect(ui).toContain('Web Control · theo dõi');
    expect(ui).toContain('/api/web-control-status');
    expect(ownerAuth).toContain("return redirect(res, '/?owner=connected')");
    expect(ownerAuth).not.toContain("return redirect(res, '/index.html?owner=connected')");
  });

  it('renders account identity separately from TigerIQ authorization and keeps login visible before OAuth configuration', () => {
    expect(ui).toContain('id="accountAvatar"');
    expect(ui).toContain('id="accountName"');
    expect(ui).toContain('id="accountRole"');
    expect(ui).toContain('Google xác thực danh tính · TigerIQ cấp quyền');
    expect(ui).toContain('<button id="authBtn" class="btn orange">Đăng nhập</button>');
    expect(ui).toContain("OAuth chưa cấu hình. Nút Đăng nhập vẫn hiển thị");
    expect(ownerAuth).toContain('identity');
    expect(ownerAuth).toContain("authority: 'TigerIQ'");
    expect(ownerAuth).toContain("implementedRoles: ['Owner']");
    expect(ownerAuth).toContain("requestedRoles: ['Owner', 'Admin', 'Nhân viên', 'Chỉ xem']");
    expect(ownerAuth).toContain("providerInterface: '06-work-management-rbac-required'");
    expect(ownerAuth).toContain('googleControlsAuthorization: false');
    expect(statusApi).toContain("role: ownerAuthenticated ? 'Owner' : null");
    expect(statusApi).toContain("providerInterface: '06-work-management-rbac-required'");
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

  it('fails closed unless Owner identity and server-side GitHub write are both ready', () => {
    expect(statusApi).toContain('authenticated: ownerAuthenticated');
    expect(statusApi).toContain('serverWriteConfigured: Boolean(GITHUB_TOKEN)');
    expect(statusApi).toContain('writeReady: Boolean(ownerAuthenticated && GITHUB_TOKEN)');
    expect(ui).toContain("$('dispatchBtn').disabled=!owner.writeReady||busy");
    expect(ui).toContain("$('canaryBtn').disabled=!owner.writeReady||busy");
    expect(ui).toContain('TigerIQ fail-closed ở Chỉ xem');
  });

  it('moves workforce into an internal module and refresh into a mobile-friendly floating control', () => {
    expect(ui).toContain('id="workforceModuleBtn"');
    expect(ui).toContain('href="/workforce"');
    expect(ui).toContain('Module · Nhân sự AI & thiết bị');
    expect(ui).not.toContain('<div class="top-actions"><a class="btn" href="/workforce">Nhân sự AI</a>');
    expect(ui).toContain('.refresh-fab{position:fixed');
    expect(ui).toContain('id="refreshBtn" class="btn refresh-fab"');
  });

  it('separates PC01 execution evidence from physical-device assumptions', () => {
    expect(statusApi).toContain("physicalState: 'unknown'");
    expect(ui).toContain('Trạng thái vật lý PC01');
    expect(ui).toContain('KHÔNG SUY ĐOÁN');
    expect(ui).toContain('REVIEW PASS');
    expect(ui).toContain('JUDGE PASS');
  });

  it('renders lifecycle truthfully and never says a canonical canary was newly created', () => {
    expect(ui).toContain("closed_unverified:'ĐÓNG NHƯNG CHƯA XÁC MINH'");
    expect(ui).toContain("evidence_pending:'CHỜ BẰNG CHỨNG'");
    expect(ui).toContain("review_pending:'CHỜ REVIEW'");
    expect(ui).toContain("gate_pending:'CHỜ GATE'");
    expect(ui).toContain("completed:'HOÀN TẤT ĐÃ XÁC MINH'");
    expect(ui).toContain('RESULT · THIẾU EVIDENCE');
    expect(ui).toContain('RESULT + EVIDENCE');
    expect(ui).toContain('DONE VERIFIED');
    expect(ui).toContain('Đã dùng canary chuẩn #');
    expect(ui).toContain('không tạo Issue mới');
    expect(ui).not.toContain("'Đã tạo canary #'");
  });

  it('uses server-side GitHub credentials only for read/write plumbing and never returns them', () => {
    expect(statusApi).toContain("const GITHUB_TOKEN = String(process.env.TIGERIQ_GITHUB_TOKEN || '').trim()");
    expect(statusApi).toContain('headers.authorization = `Bearer ${GITHUB_TOKEN}`');
    expect(statusApi).not.toMatch(/GITHUB_TOKEN\s*[,}]/);
  });
});