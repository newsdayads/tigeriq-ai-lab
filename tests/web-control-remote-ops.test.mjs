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

  it('renders familiar account UX with Google sign-in and logout', () => {
    for (const id of ['accountBox','accountMenu','accountAvatar','accountName','accountEmail','accountRole','accountMenuAvatar','accountMenuName','accountMenuEmail','accountMenuRole','authBtn','logoutBtn']) {
      expect(ui).toContain(`id="${id}"`);
    }
    expect(ui).toContain('Tiếp tục với Google');
    expect(ui).toContain('class="google-icon"');
    expect(ui).toContain('Google xác thực danh tính · TigerIQ cấp quyền');
    expect(ui).toContain('/api/owner-auth?action=login');
    expect(ui).toContain('/api/owner-auth?action=logout');
    expect(ownerAuth).toContain("action === 'logout'");
    expect(ownerAuth).toContain('clearOwnerCookies(res)');
  });

  it('keeps identity and TigerIQ authorization separate and truthful', () => {
    expect(ui).toContain('OAuth chưa cấu hình · TigerIQ đang fail-closed ở Chỉ xem');
    expect(ownerAuth).toContain("authority: 'TigerIQ'");
    expect(ownerAuth).toContain("implementedRoles: ['Owner']");
    expect(ownerAuth).toContain("requestedRoles: ['Owner', 'Admin', 'Nhân viên', 'Chỉ xem']");
    expect(ownerAuth).toContain("providerInterface: '06-work-management-rbac-required'");
    expect(ownerAuth).toContain('googleControlsAuthorization: false');
    expect(statusApi).toContain("role: ownerAuthenticated ? 'Owner' : null");
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