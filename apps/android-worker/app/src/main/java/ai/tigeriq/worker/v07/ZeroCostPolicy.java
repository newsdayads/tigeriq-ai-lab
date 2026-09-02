package ai.tigeriq.worker.v07;

/** Mandatory fail-closed zero-cost execution gate for phone-owned AI providers. */
public final class ZeroCostPolicy {
    private ZeroCostPolicy() {}

    public static void requireExecutionAllowed(String providerId, ZeroCostAuthority authority) throws ProviderException {
        String provider = providerId == null || providerId.isBlank()
                ? "provider" : providerId.trim().toLowerCase(java.util.Locale.ROOT);
        ZeroCostAuthority checked = authority == null ? ZeroCostAuthority.current() : authority;
        if (checked.executionAllowed()) return;
        throw new ProviderException(provider, "ZERO_COST_AUTHORITY_UNVERIFIED",
                "Provider execution disabled: independent enforceable zero-cost authority is not available (" + checked.reason() + ")",
                false, 0);
    }

    /**
     * Testable no-network guard. The connector cannot run from any local/user
     * billing claim; it requires an independently established authority object.
     */
    public static ProviderExecution executeIfAuthorized(ZeroCostAuthority authority, AiProviderConnector connector,
                                                        String prompt, String model) throws ProviderException {
        if (connector == null) {
            throw new ProviderException("provider", "PROVIDER_UNSUPPORTED",
                    "provider connector is not installed on this phone", false, 0);
        }
        requireExecutionAllowed(connector.providerId(), authority);
        return connector.execute(prompt, model);
    }
}
