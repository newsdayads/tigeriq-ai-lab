const PHYSICAL_TARGETS = [
  /\bpc01\b/i,
  /\bpc\b/i,
  /\bwindows\b/i,
  /\bscheduled\s+tasks?\b/i,
  /\bwatchdog\b/i,
  /\btailscale\b/i,
  /\bollama\b/i,
  /\bz\s*flip\b/i,
  /\bz\s*fold\b/i,
  /\bandroid\s+(?:phone|device|app|worker)\b/i,
  /\b(?:phone|device|hardware)\b/i,
  /(?:điện thoại|thiết bị|phần cứng|máy tính)/i,
];

const PHYSICAL_ACTIONS = [
  /(?:kiểm tra|xác minh|test|smoke|status|trạng thái|hoạt động|online|đang chạy|chạy chưa)/i,
  /(?:audit|inspect|diagnose|chẩn đoán|đọc log|xem log|logs?|telemetry)/i,
  /(?:reboot|restart|khởi động|khởi động lại|tắt máy|bật máy)/i,
  /(?:cài đặt|cài|gỡ|install|uninstall|deploy|update|nâng cấp)/i,
  /(?:kết nối|connect|điều khiển|control|mở|bật|tắt|activate|kích hoạt)/i,
  /(?:scheduled\s+task|watchdog|listener|service|process|tiến trình)/i,
];

const EXPLICIT_PHYSICAL_STATE = [
  /\bpc01\b[\s\S]{0,80}(?:hoạt động|online|status|trạng thái|đang chạy|chạy chưa|runtime|process|service|log)/i,
  /(?:hoạt động|online|status|trạng thái|đang chạy|chạy chưa|runtime|process|service|log)[\s\S]{0,80}\bpc01\b/i,
  /(?:z\s*flip|z\s*fold|điện thoại|phone|device)[\s\S]{0,80}(?:smoke|cài|install|test|kiểm tra)/i,
];

const REPO_ANALYSIS_CONTEXT = /(?:tài liệu|document|docs?|code|mã nguồn|repo|repository|branch|pull request|\bpr\b|kiến trúc|architecture|thiết kế|design|source)/i;
const HARD_RUNTIME_ACTION = /(?:hoạt động|online|status|trạng thái|đang chạy|chạy chưa|runtime|reboot|restart|khởi động|tắt máy|bật máy|cài đặt|cài|gỡ|install|uninstall|deploy|kết nối|connect|activate|kích hoạt|smoke|process|service|tiến trình|đọc log|xem log|telemetry)/i;

export function executionRequirementForInstruction(instruction) {
  const text = String(instruction || '').trim();
  if (!text) return { kind: 'cloud-bounded', pc01Required: false, cloudExecutorAllowed: true, source: null, reason: 'bounded_reasoning_default' };

  const explicit = EXPLICIT_PHYSICAL_STATE.some((pattern) => pattern.test(text));
  const target = PHYSICAL_TARGETS.some((pattern) => pattern.test(text));
  const action = PHYSICAL_ACTIONS.some((pattern) => pattern.test(text));
  const repoAnalysis = REPO_ANALYSIS_CONTEXT.test(text);
  const hardRuntime = HARD_RUNTIME_ACTION.test(text);

  if (!explicit && repoAnalysis && !hardRuntime) {
    return { kind: 'cloud-bounded', pc01Required: false, cloudExecutorAllowed: true, source: null, reason: 'repository_analysis_explicit' };
  }

  if (explicit || (target && action)) {
    const pc01 = /\bpc01\b|\bpc\b|\bwindows\b|scheduled\s+task|watchdog|tailscale|ollama|máy tính/i.test(text);
    return {
      kind: pc01 ? 'pc01-runtime' : 'device-runtime',
      pc01Required: pc01,
      cloudExecutorAllowed: false,
      source: pc01 ? 'pc01-runtime-required' : 'device-runtime-required',
      reason: pc01 ? 'pc01_runtime_evidence_required' : 'physical_device_evidence_required',
    };
  }

  return { kind: 'cloud-bounded', pc01Required: false, cloudExecutorAllowed: true, source: null, reason: 'bounded_reasoning_default' };
}
