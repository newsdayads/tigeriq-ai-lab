import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  containsBareEnglishOwnerStatus,
  localizeOwnerFacingText,
  ownerFacingWorkRow,
  ownerStatusLabel,
} from '../apps/tigeriq-core/owner-facing-vietnamese.mjs';
import { formatResultComment } from '../apps/tigeriq-core/github-intake.mjs';
import {
  coreUiTerminalStateFromComment,
  formatCoreUiTerminalComment,
} from '../apps/tigeriq-core/core-ui-assignment.mjs';
import { ownerFacingHandoffLifecycle } from '../apps/tigeriq-core/work-handoff.mjs';

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
    });
    expect(row.stage).toBe('HOÀN TẤT');
    expect(row.blocker).toContain('phương án dự phòng ĐẠT');
    expect(row.nextAction).toContain('rà soát cuối HOÀN TẤT');
    expect(containsBareEnglishOwnerStatus(JSON.stringify(row))).toBe(false);
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
    expect(source).toContain("^apps/tigeriq-core/owner-facing-vietnamese\\.mjs$");
  });
});
