import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  containsBareEnglishOwnerStatus,
  localizeOwnerFacingText,
  ownerFacingWorkRow,
  ownerStatusLabel,
  ownerStatusIcon,
  verifiedOwnerProgress,
  ownerFacingPresentation,
  validateOwnerFacingOutput,
  containsUnapprovedOwnerIcon,
  OWNER_ALLOWED_ICONS,
  OWNER_SURFACE_REGISTRY,
} from '../apps/tigeriq-core/owner-facing-vietnamese.mjs';
import { formatResultComment } from '../apps/tigeriq-core/github-intake.mjs';
import {
  coreUiTerminalStateFromComment,
  formatCoreUiTerminalComment,
} from '../apps/tigeriq-core/core-ui-assignment.mjs';
import { ownerFacingHandoffLifecycle } from '../apps/tigeriq-core/work-handoff.mjs';
import { ownerCodingComment } from '../apps/tigeriq-core/github-coding-intake.mjs';

describe('Owner-facing Vietnamese output gate', () => {
  it('maps every required machine status to Vietnamese', () => {
    const cases = {
      PASS: 'ĐẠT',
      DONE: 'HOÀN TẤT',
      COMPLETED: 'HOÀN TẤT',
      WORKING: 'ĐANG XỬ LÝ',
      RUNNING: 'ĐANG XỬ LÝ',
      READY: 'SẴN SÀNG',
      WAITING: 'ĐANG CHỜ',
      WAIT_RESOURCE: 'ĐANG CHỜ',
      BLOCKED: 'BỊ CHẶN',
      FAILED: 'LỖI',
      ERROR: 'LỖI',
      EXTERNAL_WAIT: 'CHỜ BÊN NGOÀI',
      OWNER_APPROVAL_REQUIRED: 'CHỜ ANH SƠN DUYỆT',
    };
    for (const [machine, expected] of Object.entries(cases)) {
      expect(ownerStatusLabel(machine)).toBe(expected);
    }
  });

  it('localizes required Owner-facing terms and leaves no bare English status', () => {
    const input = 'final review PASS; deep cross-check DONE; live acceptance READY; canary WAITING; fallback BLOCKED; routing ERROR; EXTERNAL_WAIT; OWNER_APPROVAL_REQUIRED';
    const output = localizeOwnerFacingText(input);
    expect(output).toContain('rà soát cuối ĐẠT');
    expect(output).toContain('kiểm tra chéo chuyên sâu HOÀN TẤT');
    expect(output).toContain('nghiệm thu trực tiếp SẴN SÀNG');
    expect(output).toContain('kiểm thử thực tế ĐANG CHỜ');
    expect(output).toContain('phương án dự phòng BỊ CHẶN');
    expect(output).toContain('định tuyến LỖI');
    expect(output).toContain('CHỜ BÊN NGOÀI');
    expect(output).toContain('CHỜ ANH SƠN DUYỆT');
    expect(containsBareEnglishOwnerStatus(output)).toBe(false);
  });

  it('renders Core claim/result-style terminal comments in Vietnamese', () => {
    const output = formatResultComment({
      id: 'OBJ-GH-2682',
      status: 'completed',
      summary: 'final review PASS; fallback READY',
    });
    expect(output).toContain('[KẾT QUẢ] TigerIQ Core đã hoàn tất OBJ-GH-2682');
    expect(output).toContain('rà soát cuối ĐẠT');
    expect(output).toContain('phương án dự phòng SẴN SÀNG');
    expect(containsBareEnglishOwnerStatus(output)).toBe(false);
  });

  it('renders Core UI terminal evidence in Vietnamese and preserves legacy parsing', () => {
    const output = formatCoreUiTerminalComment({
      jobId: 'GH-2682',
      workerId: 'NV04',
      state: 'DONE',
      result: 'deep cross-check PASS\nDONE',
    });
    expect(output).toContain('Trạng thái: HOÀN TẤT');
    expect(output).toContain('TRẠNG_THÁI=HOÀN TẤT');
    expect(output).not.toContain('STATE=DONE');
    expect(containsBareEnglishOwnerStatus(output)).toBe(false);
    expect(coreUiTerminalStateFromComment(output)).toBe('DONE');
    expect(coreUiTerminalStateFromComment('STATE=EXTERNAL_WAIT')).toBe('EXTERNAL_WAIT');
  });

  it('localizes Live/status rows before Owner serialization', () => {
    const row = ownerFacingWorkRow({
      number: 2682,
      status: 'BLOCKED',
      waitReason: 'fallback WAIT_RESOURCE',
      currentStep: 'final review READY',
      detail: 'routing ERROR',
    });
    expect(row).toMatchObject({
      status: 'BỊ CHẶN',
      waitReason: 'phương án dự phòng ĐANG CHỜ',
      currentStep: 'rà soát cuối SẴN SÀNG',
      detail: 'định tuyến LỖI',
    });
    expect(JSON.stringify(row)).not.toMatch(/\b(?:PASS|DONE|COMPLETED|WORKING|RUNNING|READY|QUEUED|WAITING|WAIT_RESOURCE|BLOCKED|FAILED|ERROR|EXTERNAL_WAIT|OWNER_APPROVAL_REQUIRED)\b/);
  });

  it('localizes checkpoint/handoff lifecycle for Owner', () => {
    const row = ownerFacingHandoffLifecycle({
      status: 'completed',
      blocker: 'none after fallback PASS',
      next: 'final review DONE',
      progress: { passed: 4, total: 5, verified: true },
    });
    expect(row.stage).toBe('HOÀN TẤT');
    expect(row.icon).toBe('✅');
    expect(row.progressPresentation.text).toBe('████████░░ 80%');
    expect(row.blocker).toContain('phương án dự phòng ĐẠT');
    expect(row.nextAction).toContain('rà soát cuối HOÀN TẤT');
    expect(containsBareEnglishOwnerStatus(JSON.stringify(row))).toBe(false);
  });

  it('handoff only shows evidence-backed progress', () => {
    const verified = ownerFacingHandoffLifecycle({
      status: 'working',
      progress: { passed: 4, total: 5, verified: true },
    });
    expect(verified.icon).toBe('⚙️');
    expect(verified.progressPresentation.text).toBe('████████░░ 80%');

    const stale = ownerFacingHandoffLifecycle({
      status: 'working',
      progress: { passed: 4, total: 5, stale: true },
    });
    expect(stale.progressPresentation).toBeUndefined();
  });

  it('keeps Web Control blocked/working display buckets Vietnamese', () => {
    const source = readFileSync(new URL('../apps/tigeriq-core/web-control-server.mjs', import.meta.url), 'utf8');
    expect(source).toContain("bucket=ownerStatusLabel('BLOCKED')");
    expect(source).toContain("bucket=ownerStatusLabel('WORKING')");
    expect(source).not.toContain("bucket='BLOCKED'");
  });

  it('packages the shared Vietnamese renderer into isolated Web Control runtime', () => {
    const source = readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1', import.meta.url), 'utf8');
    expect(source).toContain("@{src='apps\\tigeriq-core\\owner-facing-vietnamese.mjs';dst='owner-facing-vietnamese.mjs'}");
    expect(source).toContain("$_ -eq 'apps/tigeriq-core/owner-facing-vietnamese.mjs'");
  });
  it('enforces the shared compact presentation contract', () => {
    expect(OWNER_SURFACE_REGISTRY).toHaveLength(8);
    expect(ownerStatusIcon('DONE')).toBe('✅');
    expect(ownerStatusIcon('WORKING')).toBe('⚙️');
    expect(ownerStatusIcon('BLOCKED')).toBe('⚠️');
    expect(ownerStatusIcon('OWNER_APPROVAL_REQUIRED')).toBe('🔒');

    const progress = verifiedOwnerProgress({ passed: 7, total: 10, verified: true });
    expect(progress).toMatchObject({ percent: 70, text: '███████░░░ 70%', verified: true });
    expect(verifiedOwnerProgress({ passed: 7, total: 10 })).toBeNull();
    expect(verifiedOwnerProgress({ passed: 7, total: 10, stale: true, verified: true })).toBeNull();
    expect(verifiedOwnerProgress({ passed: 7, total: 10, conflicting: true })).toBeNull();
    expect(verifiedOwnerProgress({ passed: 7, total: 0 })).toBeNull();

    const presentation = ownerFacingPresentation({
      status: 'WORKING',
      result: 'final review PASS',
      blocker: 'fallback WAITING',
      nextAction: 'routing READY',
      progress: { passed: 2, total: 4, verified: true },
    });
    expect(presentation.icon).toBe('⚙️');
    expect(presentation.progress.text).toBe('█████░░░░░ 50%');
    expect(presentation.result).toContain('rà soát cuối ĐẠT');
    expect(presentation.blocker).toContain('phương án dự phòng ĐANG CHỜ');
    expect(presentation.nextAction).toContain('định tuyến SẴN SÀNG');
    expect(presentation.order).toEqual(['KẾT QUẢ', 'VƯỚNG', 'BƯỚC TIẾP THEO']);
  });

  it('covers localized Live/Web states with the same icon contract', () => {
    expect(ownerStatusIcon('ĐANG LÀM')).toBe('⚙️');
    expect(ownerStatusIcon('CHỜ')).toBe('⏳');
    expect(ownerStatusIcon('RẢNH')).toBe('⏳');
    expect(ownerStatusIcon('TẠM NGƯNG')).toBe('⚠️');
    expect(ownerStatusIcon('CHƯA XÁC MINH')).toBe('⚠️');
    expect(ownerStatusIcon('HOÀN THÀNH')).toBe('✅');
    expect(ownerStatusIcon('CHỜ ANH SƠN')).toBe('🔒');
  });

  it('routes TigerIQ Live and Web Control rows through the shared contract', () => {
    const liveSource = readFileSync(new URL('../api/live-status.mjs', import.meta.url), 'utf8');
    const webSource = readFileSync(new URL('../apps/tigeriq-core/web-control-server.mjs', import.meta.url), 'utf8');
    expect(liveSource).toContain('workers: rows.map(ownerFacingWorkRow)');
    expect(liveSource).toContain('.map(ownerFacingWorkRow);');
    expect(liveSource).toContain('verified: true');
    expect(webSource).toContain('statusIcon:ownerStatusIcon(state)');
    expect(webSource).toContain('bucketIcon:ownerStatusIcon(bucket)');
  });

  it('hard-loads Interaction #504 for every new chat and registers all Owner surfaces', () => {
    const loader = readFileSync(new URL('../bootstrap/00_TIGERIQ_LOADER.md', import.meta.url), 'utf8');
    const sourceIndex = readFileSync(new URL('../bootstrap/06_TIGERIQ_SOURCE_INDEX.md', import.meta.url), 'utf8');
    expect(loader).toContain('OWNER INTERACTION HARD-LOAD V1');
    expect(loader).toContain('Luôn đọc Interaction Policy #504 trước phản hồi Owner đầu tiên');
    expect(sourceIndex).toContain('Interaction #504 bắt buộc mọi NEW CHAT');
    expect(OWNER_SURFACE_REGISTRY).toEqual([
      'DIRECT_CHAT_NEW_CHAT',
      'CORE_GITHUB_COMMENTS',
      'NV_API_OUTPUT',
      'UI_WORKER_OUTPUT',
      'CODING_LANE_SUMMARY',
      'QUEUE_CHECKPOINT_HANDOFF_REPORT',
      'TIGERIQ_LIVE_WEB_CONTROL',
      'AUTOMATION_NOTICE',
    ]);
  });

  it('renders verified progress only from evidence-backed numerator/denominator', () => {
    const row = ownerFacingWorkRow({
      status: 'WORKING',
      progress: { passed: 3, total: 5, verified: true },
      currentStep: 'final review READY',
    });
    expect(row.statusIcon).toBe('⚙️');
    expect(row.progressPresentation.text).toBe('██████░░░░ 60%');

    const stale = ownerFacingWorkRow({
      status: 'WORKING',
      progress: { passed: 3, total: 5, stale: true },
    });
    expect(stale.progressPresentation).toBeUndefined();
  });

  it('routes Coding Lane Owner comments through the shared presentation gate', () => {
    expect(ownerCodingComment('[CLAIM] job READY')).toBe('⚙️ [TIẾP NHẬN] job SẴN SÀNG');
    expect(ownerCodingComment('[RESULT] job DONE')).toBe('✅ [KẾT QUẢ] job HOÀN TẤT');
    expect(ownerCodingComment('[BLOCKED_FINAL] job ERROR')).toBe('⚠️ [BỊ CHẶN] job LỖI');
  });

  it('rejects non-canonical icons and hard-loads the direct-chat icon guard', () => {
    expect(OWNER_ALLOWED_ICONS).toEqual(['✅', '⚙️', '⏳', '⚠️', '🔒', '💡', '📌', '➡️']);
    expect(containsUnapprovedOwnerIcon('⚙️ ĐANG XỬ LÝ')).toBe(false);
    expect(containsUnapprovedOwnerIcon('📌 Điểm chính ➡️ Bước tiếp theo')).toBe(false);
    expect(containsUnapprovedOwnerIcon('🔴 P1 đang xử lý')).toBe(true);
    expect(containsUnapprovedOwnerIcon('🟠 P2 đang chờ')).toBe(true);
    expect(containsUnapprovedOwnerIcon('⚪ P4')).toBe(true);
    expect(validateOwnerFacingOutput({ text: '🔴 P1 đang xử lý' }).defects)
      .toContain('UNAPPROVED_ICON');

    const loader = readFileSync(new URL('../bootstrap/00_TIGERIQ_LOADER.md', import.meta.url), 'utf8');
    expect(loader).toContain('DIRECT CHAT PRE-SEND ICON GUARD V1');
    expect(loader).toContain('✅ ⚙️ ⏳ ⚠️ 🔒 💡 📌 ➡️');
    expect(loader).toContain('🔴 🟠 🟡 🟢 🔵 🟣 ⚪ ⚫');
  });

  it('fails closed on guessed/stale progress and bare machine status', () => {
    expect(validateOwnerFacingOutput({ text: '⚙️ Đang làm 70%', progress: null }).defects)
      .toContain('UNVERIFIED_PROGRESS_PERCENT');
    expect(validateOwnerFacingOutput({
      text: '███████░░░ 70%',
      progress: { passed: 7, total: 10, stale: true },
      evidenceFresh: false,
    }).defects).toEqual(expect.arrayContaining(['UNVERIFIED_PROGRESS_PERCENT', 'STALE_PROGRESS_VISIBLE']));
    expect(validateOwnerFacingOutput({ text: 'PASS READY', progress: null }).defects)
      .toContain('BARE_ENGLISH_STATUS');
    expect(validateOwnerFacingOutput({ text: '✅ HOÀN TẤT', canonicalRefsResolved: false }).defects)
      .toContain('UNRESOLVED_WORK_REFERENCE');
    expect(validateOwnerFacingOutput({
      text: '✅ HOÀN TẤT ██████████ 100%',
      progress: { passed: 4, total: 4, verified: true },
    })).toMatchObject({ ok: true, defects: [] });
  });
});
