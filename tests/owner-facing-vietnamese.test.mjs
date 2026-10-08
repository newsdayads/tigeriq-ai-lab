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
  containsBareOwnerWorkReference,
  containsBareOwnerPrReference,
  containsOwnerFacingEnglishOperationalProse,
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
      OWNER_GATE: 'CHỜ ANH SƠN DUYỆT',
      OWNER_APPROVAL_REQUIRED: 'CHỜ ANH SƠN DUYỆT',
    };
    for (const [machine, expected] of Object.entries(cases)) {
      expect(ownerStatusLabel(machine)).toBe(expected);
    }
  });

  it('localizes required Owner-facing terms and leaves no bare English status', () => {
    const input = 'final review PASS; deep cross-check DONE; live acceptance READY; canary WAITING; fallback BLOCKED; routing ERROR; EXTERNAL_WAIT; OWNER_GATE; OWNER_APPROVAL_REQUIRED';
    const output = localizeOwnerFacingText(input);
    expect(output).toContain('rà soát cuối ĐẠT');
    expect(output).toContain('kiểm tra chéo chuyên sâu HOÀN TẤT');
    expect(output).toContain('nghiệm thu trực tiếp SẴN SÀNG');
    expect(output).toContain('kiểm thử thực tế ĐANG CHỜ');
    expect(output).toContain('phương án dự phòng BỊ CHẶN');
    expect(output).toContain('định tuyến LỖI');
    expect(output).toContain('CHỜ BÊN NGOÀI');
    expect(output.match(/CHỜ ANH SƠN DUYỆT/g)).toHaveLength(2);
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

  it('localizes Live title, next action, blocker and mixed operational terms', () => {
    const row = ownerFacingWorkRow({
      number: 4521,
      title: '[P1][CORE vNext] Pin Deep Agents/LangGraph + Postgres checkpoint nền shadow',
      status: 'WORKING',
      nextStep: 'Repair UPDATER_WATCHDOG_HEALTH rồi final review Core NV API',
      blocker: 'Credential material/private-repo auth missing',
    });
    expect(row.title).toContain('Deep Agents/LangGraph (khung điều phối tác nhân)');
    expect(row.title).toContain('điểm lưu trạng thái');
    expect(row.title).toContain('chạy song song');
    expect(row.nextStep).toContain('sửa lỗi UPDATER_WATCHDOG_HEALTH');
    expect(row.nextStep).toContain('rà soát cuối Core NV API (giao diện AI trung tâm)');
    expect(row.blocker).toContain('thông tin xác thực');
    expect(row.blocker).toContain('kho mã riêng xác thực');
  });

  it('localizes the exact current #4521 next-step phrases that previously leaked into Live', () => {
    const input = 'repairs existing PR|normal npm resolution|lockfile|isolated|foundation|smoke test|fresh exact-head CI/Queue Hygiene|only after|main readback';
    const output = localizeOwnerFacingText(input);
    expect(output).toContain('sửa lỗi PR hiện có');
    expect(output).toContain('phân giải npm thông thường');
    expect(output).toContain('tệp khóa phụ thuộc');
    expect(output).toContain('cô lập');
    expect(output).toContain('nền tảng');
    expect(output).toContain('kiểm thử nhanh');
    expect(output).toContain('kiểm tra đúng đầu nhánh mới CI/Queue Hygiene (kiểm tra vệ sinh hàng đợi)');
    expect(output).toContain('chỉ sau khi');
    expect(output).toContain('đọc lại main');
    expect(containsOwnerFacingEnglishOperationalProse(output)).toBe(false);
  });

  it('localizes the current production Live operational prose and machine wait reasons', () => {
    const productionFixtures = [
      {
        input: 'Owner creates/links private Actor outside chat from https://github.com/newsdayads/tigeriq-ai-lab#main:apps/revenue-lab/apify-website-audit; inject scoped APIFY_TOKEN + APIFY_ACTOR_ID outside chat; run APIFY_PREFLIGHT_EXECUTE=OWNER_APPROVED_PRIVATE_PREFLIGHT first; if PASS run exactly one APIFY_E2E_EXECUTE=OWNER_APPROVED_PRIVATE_TEST; capture finalized computeUnits + usageTotalUsd after 10s settle/refetch; stop before public/paid/KYC.',
        required: ['anh Sơn tạo/liên kết Actor (tác vụ Apify) riêng ngoài chat từ', 'nạp APIFY_TOKEN + APIFY_ACTOR_ID theo phạm vi ngoài chat', 'chạy APIFY_PREFLIGHT_EXECUTE=OWNER_APPROVED_PRIVATE_PREFLIGHT trước', 'nếu ĐẠT thì chạy đúng một APIFY_E2E_EXECUTE=OWNER_APPROVED_PRIVATE_TEST', 'ghi nhận computeUnits + usageTotalUsd cuối cùng sau 10 giây ổn định/đọc lại', 'dừng trước public/paid/KYC'],
      },
      {
        input: '#4488 PASS -> guarded merge PR #4461 -> media adapter/runtime/publish/live acceptance.',
        required: ['#4488 ĐẠT', 'hợp nhất có khóa bảo vệ PR #4461', 'bộ chuyển đổi media/môi trường chạy/xuất bản/nghiệm thu trực tiếp'],
      },
      {
        input: 'thông tin xác thực material/kho mã riêng xác thực must become available; then sync exact main, set nonsecret runtime config, restart News runtime, run soak/quality gates, publish, verify live.',
        required: ['phải sẵn sàng', 'sau đó', 'đồng bộ chính xác nhánh main', 'cấu hình môi trường chạy không bí mật', 'khởi động lại môi trường News', 'chạy kiểm tra bền và cổng chất lượng', 'xuất bản', 'xác minh thực tế'],
      },
      {
        input: 'Do not wait for Owner. Diagnose actual browser request, sửa lỗi, create admin, run full sandbox E2E, verify restart/duplicate behavior, benchmark, xuất bản bằng chứng.',
        required: ['Không chờ anh Sơn', 'Chẩn đoán yêu cầu trình duyệt thực tế', 'tạo quản trị viên', 'E2E (đầu-cuối)', 'chống trùng', 'đánh giá chuẩn'],
      },
      {
        input: 'Paperclip runtime is healthy, but authenticated deployment has no usable admin session because first-admin credentials have not yet been set by Owner in browser.',
        required: ['Môi trường Paperclip đang ổn', 'bản triển khai có xác thực', 'phiên quản trị', 'anh Sơn', 'trình duyệt'],
      },
      {
        input: 'When existing private-repo auth becomes available without new/changed credentials, fast-forward-only sync to d419c15; then set only nonsecret MEDIA_AUTO_PUBLISH=true + approved HTTPS CONTENT_COVER_PUBLIC_BASE_URL, restart News runtime, bounded acceptance, live verify.',
        required: ['Khi', 'kho mã riêng xác thực', 'mà không tạo hoặc thay đổi thông tin xác thực', 'chỉ đồng bộ tiến tới', 'sau đó chỉ thiết lập giá trị không bí mật', 'đã duyệt HTTPS', 'khởi động lại môi trường News', 'có giới hạn nghiệm thu', 'xác minh thực tế'],
      },
      {
        input: 'Resume only when a non-materializing lifecycle integration harness exists or Owner changes the no-new-work constraint; do not repeat the same synthetic preflight.',
        required: ['Chỉ tiếp tục khi', 'bộ kiểm thử tích hợp vòng đời không phát sinh tác vụ', 'hoặc anh Sơn thay đổi ràng buộc không tạo việc mới', 'không lặp lại cùng tiền kiểm mô phỏng'],
      },
      {
        input: 'Track #4456 through implement>test>independent review>merge>PC01 runtime>publish>live verify; reconcile #3904 and close #3899 only after verified acceptance.',
        required: ['Theo dõi #4456', 'triển khai>kiểm thử>rà soát độc lập>hợp nhất>môi trường PC01>xuất bản>xác minh thực tế', 'đối soát #3904 và đóng #3899', 'chỉ sau khi nghiệm thu đã xác minh'],
      },
      {
        input: 'Owner tạo/link private Actor và inject scoped APIFY_TOKEN + APIFY_ACTOR_ID ngoài chat; chạy preflight trước, PASS mới chạy đúng 1 private E2E.',
        required: ['anh Sơn tạo/liên kết Actor (tác vụ Apify) riêng', 'nạp theo phạm vi', 'tiền kiểm', 'ĐẠT', 'kiểm thử E2E (đầu-cuối) riêng'],
      },
      {
        input: 'PIN_PASS_AND_MERGE -> runtime apply -> sign current CI artifact -> publish manifest -> S10 acceptance',
        required: ['PIN ĐẠT VÀ HỢP NHẤT', 'áp dụng môi trường chạy', 'ký gói CI hiện hành', 'xuất bản manifest (tệp mô tả)', 'nghiệm thu S10'],
      },
      {
        input: 'system precheck -> private preflight -> request Owner secret injection only if required -> one private E2E -> measure cost -> KEEP/ITERATE/KILL',
        required: ['tiền kiểm hệ thống', 'tiền kiểm riêng', 'chỉ yêu cầu anh Sơn nạp bí mật nếu cần', 'một kiểm thử E2E (đầu-cuối) riêng', 'đo chi phí', 'GIỮ/LẶP CẢI TIẾN/DỪNG'],
      },
    ];
    const forbidden = /\b(?:must|then|sync|set|nonsecret|config|restart|run|quality|verify|wait|Owner|Diagnose|actual|browser|request|create|creates|links|outside|admin|sandbox|behavior|benchmark|healthy|authenticated|session|Resume|Track|through|implement|test|merge|guarded|close|preflight|inject|scoped|private|artifact|sign|acceptance|measure|cost|approved|bounded|capture|finalized|settle|refetch|stop|exactly)\b/i;
    for (const fixture of productionFixtures) {
      const output = localizeOwnerFacingText(fixture.input);
      for (const expected of fixture.required) expect(output).toContain(expected);
      expect(output).not.toMatch(forbidden);
      expect(containsOwnerFacingEnglishOperationalProse(output)).toBe(false);
    }

    const row = ownerFacingWorkRow({
      status: 'WAITING',
      executionEligibility: 'PARKED_DEPENDENCY',
      executionEligibilityReason: 'EXPLICIT_EXECUTION_DISABLED',
      waitReason: 'EXPLICIT_EXECUTION_DISABLED',
    });
    expect(row.executionEligibility).toBe('PARKED_DEPENDENCY');
    expect(row.executionEligibilityReason).toBe('EXPLICIT_EXECUTION_DISABLED');
    expect(row.waitReason).toBe('Tạm dừng thực thi theo nguồn chuẩn');
  });

  it('localizes OWNER_GATE rows before Live/API serialization', () => {
    const row = ownerFacingWorkRow({
      number: 2828,
      status: 'OWNER_GATE',
      currentStep: 'Chờ anh Sơn duyệt',
    });
    expect(row.status).toBe('CHỜ ANH SƠN DUYỆT');
    expect(row.statusIcon).toBe('');
    expect(containsBareEnglishOwnerStatus(JSON.stringify(row))).toBe(false);
    expect(containsBareEnglishOwnerStatus('OWNER_GATE')).toBe(true);
  });

  it('localizes checkpoint/handoff lifecycle for Owner', () => {
    const row = ownerFacingHandoffLifecycle({
      status: 'completed',
      blocker: 'none after fallback PASS',
      next: 'final review DONE',
      progress: { passed: 4, total: 5, verified: true },
    });
    expect(row.stage).toBe('HOÀN TẤT');
    expect(row.icon).toBe('');
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
    expect(verified.icon).toBe('');
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


  it('guards generated Owner-facing sources against legacy emoji returning', () => {
    const outboundSourcePaths = [
      '../apps/tigeriq-core/owner-facing-vietnamese.mjs',
      '../apps/tigeriq-core/github-coding-intake.mjs',
      '../apps/tigeriq-core/github-intake.mjs',
      '../apps/tigeriq-core/work-handoff.mjs',
      '../apps/tigeriq-core/web-control-server.mjs',
      '../apps/tigeriq-core/web-control-unified.js',
    ];
    for (const sourcePath of outboundSourcePaths) {
      const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
      expect(source, sourcePath).not.toMatch(/[\\p{Extended_Pictographic}]/u);
    }
    const liveSource = readFileSync(new URL('../api/live-status.mjs', import.meta.url), 'utf8');
    // Historical emoji may remain in legacy parsing regex, never as new result output.
    expect(liveSource).not.toContain('`✅ [KẾT QUẢ THỰC TẾ]');
    expect(liveSource).toContain('(?:✅\\s*)?\\[KẾT QUẢ THỰC TẾ\\]');
  });

  it('uses vector names only as metadata, with emoji-free text fallback', () => {
    const source = ownerFacingPresentation({ status: 'DONE', result: 'Hoàn tất' });
    expect(source.icon).toBe('');
    expect(source.iconName).toBe('circle-check');
    expect(source.result).toBe('Hoàn tất');
    expect(containsUnapprovedOwnerIcon(source.result)).toBe(false);
    const row = ownerFacingWorkRow({ status: 'BLOCKED', title: 'Cần xử lý' });
    expect(row.statusIcon).toBe('');
    expect(row.statusIconName).toBe('alert-triangle');
    expect(validateOwnerFacingOutput({ text: '✅ Đã xong' }).defects).toContain('UNAPPROVED_ICON');
    expect(validateOwnerFacingOutput({ text: '⏳ Đang chờ' }).defects).toContain('UNAPPROVED_ICON');
  });

  it('enforces the shared compact presentation contract', () => {
    expect(OWNER_SURFACE_REGISTRY).toHaveLength(8);
    expect(ownerStatusIcon('DONE')).toBe('');
    expect(ownerStatusIcon('WORKING')).toBe('');
    expect(ownerStatusIcon('BLOCKED')).toBe('');
    expect(ownerStatusIcon('OWNER_GATE')).toBe('');
    expect(ownerStatusIcon('OWNER_APPROVAL_REQUIRED')).toBe('');

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
    expect(presentation.icon).toBe('');
    expect(presentation.progress.text).toBe('█████░░░░░ 50%');
    expect(presentation.result).toContain('rà soát cuối ĐẠT');
    expect(presentation.blocker).toContain('phương án dự phòng ĐANG CHỜ');
    expect(presentation.nextAction).toContain('định tuyến SẴN SÀNG');
    expect(presentation.order).toEqual(['KẾT QUẢ', 'VƯỚNG', 'BƯỚC TIẾP THEO']);
  });

  it('covers localized Live/Web states with the same icon contract', () => {
    expect(ownerStatusIcon('ĐANG LÀM')).toBe('');
    expect(ownerStatusIcon('CHỜ')).toBe('');
    expect(ownerStatusIcon('RẢNH')).toBe('');
    expect(ownerStatusIcon('TẠM NGƯNG')).toBe('');
    expect(ownerStatusIcon('CHƯA XÁC MINH')).toBe('');
    expect(ownerStatusIcon('HOÀN THÀNH')).toBe('');
    expect(ownerStatusIcon('CHỜ ANH SƠN')).toBe('');
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
    expect(row.statusIcon).toBe('');
    expect(row.progressPresentation.text).toBe('██████░░░░ 60%');

    const stale = ownerFacingWorkRow({
      status: 'WORKING',
      progress: { passed: 3, total: 5, stale: true },
    });
    expect(stale.progressPresentation).toBeUndefined();
  });

  it('routes Coding Lane Owner comments through the shared presentation gate', () => {
    expect(ownerCodingComment('[CLAIM] job READY')).toBe('[TIẾP NHẬN] job SẴN SÀNG');
    expect(ownerCodingComment('[RESULT] job DONE')).toBe('[KẾT QUẢ] job HOÀN TẤT');
    expect(ownerCodingComment('[BLOCKED_FINAL] job ERROR')).toBe('[BỊ CHẶN] job LỖI');
  });

  it('rejects non-canonical icons and hard-loads the direct-chat icon guard', () => {
    expect(OWNER_ALLOWED_ICONS).toEqual(['circle-check', 'loader-circle', 'clock-3', 'alert-triangle', 'lock-keyhole', 'lightbulb', 'pin', 'arrow-right']);
    expect(containsUnapprovedOwnerIcon('⚙️ ĐANG XỬ LÝ')).toBe(true);
    expect(containsUnapprovedOwnerIcon('📌 Điểm chính ➡️ Bước tiếp theo')).toBe(true);
    expect(containsUnapprovedOwnerIcon('🔴 P1 đang xử lý')).toBe(true);
    expect(containsUnapprovedOwnerIcon('🟠 P2 đang chờ')).toBe(true);
    expect(containsUnapprovedOwnerIcon('⚪ P4')).toBe(true);
    expect(validateOwnerFacingOutput({ text: '🔴 P1 đang xử lý' }).defects)
      .toContain('UNAPPROVED_ICON');

    const loader = readFileSync(new URL('../bootstrap/00_TIGERIQ_LOADER.md', import.meta.url), 'utf8');
    expect(loader).toContain('DIRECT CHAT PRE-SEND ICON GUARD V5');
    expect(loader).toContain('ICON_MODE=VECTOR_OR_TEXT_NO_EMOJI');
    expect(loader).toContain('Không sinh emoji');
  });

  it('fails closed on English operational prose and bare work references across direct chat', () => {
    expect(containsOwnerFacingEnglishOperationalProse('Đang review rồi merge sau')).toBe(true);
    expect(containsOwnerFacingEnglishOperationalProse('Đang rà soát rồi hợp nhất sau')).toBe(false);
    expect(containsOwnerFacingEnglishOperationalProse('đã pass nhưng chưa done')).toBe(true);
    expect(containsOwnerFacingEnglishOperationalProse('Giữ nguyên `SAVE_NOT_DURABLE` trong log kỹ thuật')).toBe(false);

    expect(containsBareOwnerWorkReference('Đang xử lý #4129')).toBe(true);
    expect(containsBareOwnerWorkReference('Đang xử lý #4129 - Chặn cứng tiếng Anh')).toBe(false);
    expect(containsBareOwnerPrReference('PR #4130 đang chờ')).toBe(true);
    expect(containsBareOwnerPrReference('PR #4130 - Chặn cứng tiếng Anh')).toBe(false);

    expect(validateOwnerFacingOutput({ text: 'Đang review #4129 rồi merge PR #4130' }).defects)
      .toEqual(expect.arrayContaining(['ENGLISH_OPERATIONAL_PROSE', 'BARE_WORK_REFERENCE', 'BARE_PR_REFERENCE']));
    expect(validateOwnerFacingOutput({
      text: '#4129 - Chặn cứng tiếng Anh đang được rà soát; PR #4130 - Chặn cứng tiếng Anh',
      canonicalRefsResolved: true,
    })).toMatchObject({ ok: true, defects: [] });
    expect(validateOwnerFacingOutput({
      text: '#4129 - sai-tieu-de',
    }).defects).toContain('UNRESOLVED_WORK_REFERENCE');

    const loader = readFileSync(new URL('../bootstrap/00_TIGERIQ_LOADER.md', import.meta.url), 'utf8');
    const workflow = readFileSync(new URL('../bootstrap/02_TIGERIQ_WORKFLOW.md', import.meta.url), 'utf8');
    expect(loader).toContain('DIRECT CHAT PRE-SEND VALIDATOR V2');
    expect(loader).toContain('KHÔNG ĐƯỢC GỬI');
    expect(workflow).toContain('Cổng kiểm tra trước khi gửi — bắt buộc xuyên mọi chat');
    expect(workflow).toContain('#<số> - <tiêu đề chuẩn>');
    expect(loader).toContain('DIRECT CHAT PRE-SEND VALIDATOR V3');
    expect(workflow).toContain('English (nghĩa/chức năng tiếng Việt)');
  });

  it('requires Vietnamese explanation beside unavoidable English operational terms', () => {
    const bare = [
      'runtime đang lỗi',
      'health chưa ổn',
      'review tiếp',
      'merge sau',
      'deploy lại',
      'credential còn thiếu',
      'security cần kiểm tra',
      'browser bị treo',
      'reboot máy',
      'workflow mới',
      'evidence chưa đủ',
      'prompt này',
      'code đang sửa',
      'canary chưa chạy',
      'fallback đang dùng',
      'routing sai',
      'live chưa xác minh',
    ];
    for (const text of bare) expect(containsOwnerFacingEnglishOperationalProse(text)).toBe(true);

    const explained = [
      'runtime (môi trường chạy) đang lỗi',
      'health (tình trạng) chưa ổn',
      'review (rà soát) tiếp',
      'merge (hợp nhất) sau',
      'deploy (triển khai) lại',
      'credential (thông tin xác thực) còn thiếu',
      'security (bảo mật) cần kiểm tra',
      'browser (trình duyệt) bị treo',
      'reboot (khởi động lại) máy',
      'workflow (quy trình) mới',
      'evidence (bằng chứng) chưa đủ',
      'prompt (câu lệnh giao việc) này',
      'code (mã nguồn) đang sửa',
      'canary (kiểm thử thực tế) chưa chạy',
      'fallback (phương án dự phòng) đang dùng',
      'routing (định tuyến) sai',
      'live (thực tế) chưa xác minh',
    ];
    for (const text of explained) expect(containsOwnerFacingEnglishOperationalProse(text)).toBe(false);
  });

  it('localizes live prose while preserving the TigerIQ Live product name', () => {
    expect(localizeOwnerFacingText('live chưa xác minh')).toBe('thực tế chưa xác minh');
    expect(localizeOwnerFacingText('TigerIQ Live đang hoạt động')).toBe('TigerIQ Live đang hoạt động');
    expect(containsOwnerFacingEnglishOperationalProse('live chưa xác minh')).toBe(true);
    expect(containsOwnerFacingEnglishOperationalProse('TigerIQ Live đang hoạt động')).toBe(false);

    const row = ownerFacingWorkRow({
      status: 'WORKING',
      currentStep: 'live chưa xác minh',
      detail: 'TigerIQ Live đang hoạt động',
    });
    expect(row.currentStep).toBe('thực tế chưa xác minh');
    expect(row.detail).toBe('TigerIQ Live đang hoạt động');
    expect(containsOwnerFacingEnglishOperationalProse(JSON.stringify(row))).toBe(false);
  });

  it('localizes the expanded common operational vocabulary', () => {
    const input = 'runtime health review merge deploy release publish blocker pending active credential security browser reboot workflow evidence prompt production code self-install live';
    const output = localizeOwnerFacingText(input);
    expect(output).toContain('môi trường chạy');
    expect(output).toContain('tình trạng');
    expect(output).toContain('rà soát');
    expect(output).toContain('hợp nhất');
    expect(output).toContain('triển khai');
    expect(output).toContain('phát hành');
    expect(output).toContain('xuất bản');
    expect(output).toContain('điểm bị chặn');
    expect(output).toContain('thông tin xác thực');
    expect(output).toContain('bảo mật');
    expect(output).toContain('trình duyệt');
    expect(output).toContain('khởi động lại');
    expect(output).toContain('quy trình');
    expect(output).toContain('bằng chứng');
    expect(output).toContain('câu lệnh giao việc');
    expect(output).toContain('môi trường vận hành chính thức');
    expect(output).toContain('mã nguồn');
    expect(output).toContain('tự cài đặt');
    expect(output).toContain('thực tế');
    expect(containsOwnerFacingEnglishOperationalProse(output)).toBe(false);
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
      text: 'HOÀN TẤT ██████████ 100%',
      progress: { passed: 4, total: 4, verified: true },
    })).toMatchObject({ ok: true, defects: [] });
  });
});
