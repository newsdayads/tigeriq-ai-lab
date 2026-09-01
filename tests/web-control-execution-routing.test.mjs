import { describe, expect, it } from 'vitest';
import { executionRequirementForInstruction } from '../api/execution-routing.mjs';

describe('Web Control execution routing', () => {
  it('routes PC01 operational checks away from cloud before model invocation', () => {
    expect(executionRequirementForInstruction('Kiểm tra PC01 có hoạt động được không?')).toEqual(expect.objectContaining({
      kind: 'pc01-runtime', pc01Required: true, cloudExecutorAllowed: false, source: 'pc01-runtime-required',
    }));
    expect(executionRequirementForInstruction('Khởi động lại Windows worker và kiểm tra Scheduled Task')).toEqual(expect.objectContaining({
      kind: 'pc01-runtime', cloudExecutorAllowed: false,
    }));
    expect(executionRequirementForInstruction('Audit PC01 worker/watchdog/Ollama/Tailscale runtime và đọc log hiện tại')).toEqual(expect.objectContaining({
      kind: 'pc01-runtime', cloudExecutorAllowed: false,
    }));
  });

  it('routes physical phone smoke/install work away from cloud', () => {
    expect(executionRequirementForInstruction('Cài APK lên Z Flip rồi smoke test Gemini')).toEqual(expect.objectContaining({
      kind: 'device-runtime', pc01Required: false, cloudExecutorAllowed: false, source: 'device-runtime-required',
    }));
    expect(executionRequirementForInstruction('Kiểm tra điện thoại Z Fold sau reboot')).toEqual(expect.objectContaining({
      cloudExecutorAllowed: false,
    }));
  });

  it('keeps bounded reasoning and repository/documentation work cloud-eligible', () => {
    for (const instruction of [
      'Tóm tắt báo cáo tuần này thành 5 ý.',
      'Phân tích kiến trúc Android worker và đề xuất checklist code review.',
      'Viết tài liệu mô tả PC01 recovery flow từ dữ liệu đã cung cấp.',
      'Audit code/repo PC01 worker và review logic watchdog trong source.',
    ]) {
      expect(executionRequirementForInstruction(instruction)).toEqual(expect.objectContaining({
        kind: 'cloud-bounded', pc01Required: false, cloudExecutorAllowed: true,
      }));
    }
  });
});
