package ai.tigeriq.worker;

/**
 * Fail-closed Android-side readiness gate for provider UI adapters.
 * This class never performs provider UI actions and never treats readiness as execution evidence.
 */
public final class ProviderPolicyGate {
    public static final int MAX_PROMPT_CHARS = 4000;

    private ProviderPolicyGate() {}

    public record Context(
        String taskKind,
        String prompt,
        boolean physicalControllerVerified,
        boolean realDevicePaired,
        boolean heartbeatFresh,
        boolean stableSignedWorkerVerified,
        boolean accessibilityEnabled,
        boolean providerSessionPresent,
        boolean providerAutomationAuthorized,
        boolean requiresLoginOr2fa,
        boolean requiresPaymentOrCredentialChange
    ) {}

    public record Decision(boolean allowed, String code, String reason) {}

    public static Decision evaluate(Context context) {
        if (context == null) return deny("INVALID_CONTEXT", "provider context is required");
        if (!"research.prompt".equals(context.taskKind())) {
            return deny("UNSUPPORTED_TASK_KIND", "only bounded research.prompt tasks are allowlisted");
        }
        if (context.prompt() == null || context.prompt().trim().isEmpty()) {
            return deny("EMPTY_PROMPT", "provider prompt is required");
        }
        if (context.prompt().length() > MAX_PROMPT_CHARS) {
            return deny("PROMPT_TOO_LARGE", "provider prompt exceeds bounded size");
        }
        if (context.requiresPaymentOrCredentialChange()) {
            return deny("PAYMENT_OR_CREDENTIAL_CHANGE_FORBIDDEN", "payment and credential mutations are never allowed");
        }
        if (context.requiresLoginOr2fa()) {
            return deny("LOGIN_OR_2FA_REQUIRED", "login or 2FA requires owner-controlled physical authorization");
        }
        if (!context.physicalControllerVerified()) return deny("PC01_NOT_VERIFIED", "real PC01 Controller evidence is required");
        if (!context.realDevicePaired()) return deny("DEVICE_NOT_PAIRED", "real Android pairing evidence is required");
        if (!context.heartbeatFresh()) return deny("HEARTBEAT_STALE", "fresh authenticated heartbeat evidence is required");
        if (!context.stableSignedWorkerVerified()) return deny("STABLE_SIGNING_NOT_VERIFIED", "stable-signing continuity is required");
        if (!context.accessibilityEnabled()) return deny("ACCESSIBILITY_NOT_ENABLED", "AccessibilityService must be enabled");
        if (!context.providerSessionPresent()) return deny("PROVIDER_SESSION_MISSING", "provider session must already exist");
        if (!context.providerAutomationAuthorized()) return deny("PROVIDER_AUTOMATION_NOT_AUTHORIZED", "provider automation is not authorized");
        return new Decision(true, "READY_FOR_REAL_DEVICE_PROVIDER_TEST", "readiness only; real provider execution still requires physical evidence");
    }

    private static Decision deny(String code, String reason) {
        return new Decision(false, code, reason);
    }
}
