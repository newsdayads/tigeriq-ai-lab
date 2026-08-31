package ai.tigeriq.worker.v07;

public final class SessionLifecycle {
    private SessionLifecycle() {}

    public static boolean usable(long expiresAtEpochMs, long nowEpochMs, long skewMs) {
        if (expiresAtEpochMs <= 0L) return false;
        if (skewMs < 0L) throw new IllegalArgumentException("skew must be non-negative");
        return expiresAtEpochMs > nowEpochMs + skewMs;
    }
}
