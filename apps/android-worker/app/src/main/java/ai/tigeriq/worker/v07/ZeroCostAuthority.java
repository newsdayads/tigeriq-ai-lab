package ai.tigeriq.worker.v07;

/**
 * Execution authority for a provider credential under the Owner's zero-paid rule.
 *
 * Local/user state is never authoritative. Until TigerIQ has an independently
 * verifiable provider-side zero-spend boundary, Android exposes only UNVERIFIED.
 */
public final class ZeroCostAuthority {
    public static final String UNVERIFIED = "unverified";
    public static final String REASON_NO_ENFORCEABLE_PROOF = "NO_ENFORCEABLE_PROVIDER_BILLING_PROOF";

    private final String state;
    private final String reason;

    private ZeroCostAuthority(String state, String reason) {
        this.state = state;
        this.reason = reason;
    }

    /** Current V1 authority: fail closed because no enforceable provider billing proof is wired. */
    public static ZeroCostAuthority current() {
        return new ZeroCostAuthority(UNVERIFIED, REASON_NO_ENFORCEABLE_PROOF);
    }

    /**
     * Legacy/local claims are deliberately ignored. A checkbox, preference,
     * imported string, or user-entered value can never elevate execution.
     */
    static ZeroCostAuthority fromLocalClaim(String ignored) {
        return current();
    }

    public boolean executionAllowed() { return false; }
    public String state() { return state; }
    public String reason() { return reason; }
}
