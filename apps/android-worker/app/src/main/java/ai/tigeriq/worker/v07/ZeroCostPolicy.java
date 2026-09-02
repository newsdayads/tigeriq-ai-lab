package ai.tigeriq.worker.v07;

/**
 * Mandatory zero-cost execution gate for phone-owned AI providers.
 *
 * Only an explicit FREE_CONFIRMED state may execute a provider. Paid, missing,
 * malformed, or otherwise unknown billing state is fail-closed. This policy is
 * deliberately local and performs no network call of its own.
 */
public final class ZeroCostPolicy {
    public static final String FREE_CONFIRMED = "free_confirmed";
    public static final String PAID = "paid";
    public static final String UNKNOWN = "unknown";

    private ZeroCostPolicy() {}

    public static String normalizeBillingState(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(java.util.Locale.ROOT);
        if (FREE_CONFIRMED.equals(normalized)) return FREE_CONFIRMED;
        if (PAID.equals(normalized)) return PAID;
        return UNKNOWN;
    }

    public static void requireExecutionAllowed(String providerId, String billingState) throws ProviderException {
        String provider = providerId == null || providerId.isBlank() ? "provider" : providerId.trim().toLowerCase(java.util.Locale.ROOT);
        String state = normalizeBillingState(billingState);
        if (FREE_CONFIRMED.equals(state)) return;
        if (PAID.equals(state)) {
            throw new ProviderException(provider, "ZERO_COST_PAID_BLOCKED",
                    "Provider execution blocked because billing state is paid", false, 0);
        }
        throw new ProviderException(provider, "ZERO_COST_BILLING_UNKNOWN",
                "Provider execution blocked until zero-cost billing is explicitly confirmed", false, 0);
    }

    /**
     * Testable no-network guard: the connector is never invoked unless the
     * billing state has already passed requireExecutionAllowed().
     */
    public static ProviderExecution executeIfAllowed(String billingState, AiProviderConnector connector,
                                                     String prompt, String model) throws ProviderException {
        if (connector == null) {
            throw new ProviderException("provider", "PROVIDER_UNSUPPORTED",
                    "provider connector is not installed on this phone", false, 0);
        }
        requireExecutionAllowed(connector.providerId(), billingState);
        return connector.execute(prompt, model);
    }
}
