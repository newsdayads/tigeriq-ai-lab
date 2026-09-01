import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deployedEntry = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/command-center.html', import.meta.url), 'utf8');
const statusApi = readFileSync(new URL('../api/web-control-status.mjs', import.meta.url), 'utf8');
const ownerAuth = readFileSync(new URL('../api/owner-auth.mjs', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');

describe('WO-045 Web Control remote operations', () => {
  it('keeps the deployed root on TigerIQ AI Web Control', () => {
    expect(vercel).toContain('"source": "/", "destination": "/command-center.html"');
    expect(deployedEntry).toContain("location.replace('/command-center')");
    expect(ui).toContain('TigerIQ AI · Web Control');
    expect(ui).toContain('🐯 TigerIQ AI');
    expect(ui).toContain('Web Control · theo dõi');
    expect(ui).toContain('/api/web-control-status');
  });

  it('renders familiar account UX with official Google Identity Services and logout', () => {
    for (const id of ['accountBox','accountMenu','accountAvatar','accountName','accountEmail','accountRole','accountMenuAvatar','accountMenuName','accountMenuEmail','accountMenuRole','googleButton','logoutBtn']) {
      expect(ui).toContain(`id="${id}"`);
    }
    expect(ui).toContain('https://accounts.google.com/gsi/client?hl=vi');
    expect(ui).toContain('window.google.accounts.id.initialize');
    expect(ui).toContain('window.google.accounts.id.renderButton');
    expect(ui).toContain("text:'continue_with'");
    expect(ui).toContain('/api/owner-auth?action=identity');
    expect(ui).toContain('/api/owner-auth?action=logout');
    expect(ui).not.toContain('/api/owner-auth?action=login');
    expect(ui).toContain('Google xác thực danh tính · TigerIQ quyết định quyền quản trị nội bộ.');
    expect(ui).toContain('ID token');
    expect(ownerAuth).toContain("action === 'identity'");
    expect(ownerAuth).toContain('verifyGoogleIdToken');
    expect(ownerAuth).toContain("error: 'oauth_code_flow_retired'");
  });

  it('keeps Google identity, executive title, and TigerIQ authorization separate', () => {
    expect(ownerAuth).toContain("identityMode: 'google_id_token'");
    expect(ownerAuth).toContain('clientSecretRequired: false');
    expect(ownerAuth).not.toContain('TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET');
    expect(ownerAuth).not.toContain('oauth2.googleapis.com/token');
    expect(statusApi).toContain("authority: 'TigerIQ'");
    expect(statusApi).toContain("role: ownerAuthenticated ? 'Founder & CEO' : null");
    expect(statusApi).toContain("rbacRole: ownerAuthenticated ? 'Owner' : null");
    expect(statusApi).toContain("title: ownerAuthenticated ? 'Founder & CEO · TigerIQ AI Lab' : null");
    expect(statusApi).toContain("implementedRoles: ['Owner']");
    expect(statusApi).toContain("requestedRoles: ['Owner', 'Admin', 'Nhân viên', 'Chỉ xem']");
    expect(statusApi).toContain("providerInterface: '06-work-management-rbac-required'");
    expect(statusApi).toContain('googleControlsAuthorization: false');
    expect(ui).toContain('<div class="pill"><div class="k">Chức danh</div>');
  });

  it('allows only GIS resources needed by the identity-only flow in CSP', () => {
    expect(vercel).toContain("script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client");
    expect(vercel).toContain('https://accounts.google.com/gsi/style');
    expect(vercel).toContain('https://accounts.google.com/gsi/');
    expect(vercel).toContain('Cross-Origin-Opener-Policy');
    expect(vercel).toContain('same-origin-allow-popups');
  });

  it('keeps write controls fail-closed until server reports writeReady', () => {
    expect(statusApi).toContain('writeReady: Boolean(ownerAuthenticated && GITHUB_TOKEN)');
    expect(ui).toContain("$('dispatchBtn').disabled=!owner.writeReady||busy");
    expect(ui).toContain("$('canaryBtn').disabled=!owner.writeReady||busy");
    expect(ui).toContain('TigerIQ fail-closed ở Chỉ xem');
  });

  it('keeps workforce internal and refresh floating below account on mobile', () => {
    expect(ui).toContain('id="workforceModuleBtn"');
    expect(ui).toContain('Module · Nhân sự AI & thiết bị');
    expect(ui).toContain('.refresh-fab{position:fixed');
    expect(ui).toContain('id="refreshBtn" class="btn refresh-fab"');
    expect(ui).toContain('top:calc(max(14px,env(safe-area-inset-top)) + 126px)');
  });

  it('prevents long evidence or status strings from widening the mobile viewport', () => {
    expect(ui).toContain('overflow-x:hidden');
    expect(ui).toContain('.work a{min-width:0');
    expect(ui).toContain('overflow-wrap:anywhere');
    expect(ui).toContain('.work{min-width:0;overflow:hidden');
    expect(ui).toContain('.work-top{display:grid;grid-template-columns:minmax(0,1fr)');
  });

  it('renders lifecycle evidence truthfully', () => {
    expect(ui).toContain("closed_unverified:'ĐÓNG NHƯNG CHƯA XÁC MINH'");
    expect(ui).toContain("evidence_pending:'CHỜ BẰNG CHỨNG'");
    expect(ui).toContain("review_pending:'CHỜ REVIEW'");
    expect(ui).toContain("gate_pending:'CHỜ GATE'");
    expect(ui).toContain("completed:'HOÀN TẤT ĐÃ XÁC MINH'");
    expect(ui).toContain('RESULT · THIẾU EVIDENCE');
    expect(ui).toContain('DONE VERIFIED');
    expect(ui).toContain('Đã dùng canary chuẩn #');
    expect(ui).toContain('không tạo Issue mới');
  });
});
