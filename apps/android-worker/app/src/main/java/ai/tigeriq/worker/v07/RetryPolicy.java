package ai.tigeriq.worker.v07;

public final class RetryPolicy {
    public static final int MAX_LOCAL_RUNS = 5;
    public static final long MIN_BACKOFF_MS = 15_000L;
    public static final long MAX_BACKOFF_MS = 5 * 60_000L;

    private RetryPolicy() {}

    public static boolean canRetry(int runAttemptCount, boolean retryable) {
        return retryable && runAttemptCount + 1 < MAX_LOCAL_RUNS;
    }

    public static long backoffMs(int runAttemptCount, Long serverRetryAfterMs) {
        long exponential = MIN_BACKOFF_MS << Math.min(4, Math.max(0, runAttemptCount));
        long requested = serverRetryAfterMs == null ? 0L : Math.max(0L, serverRetryAfterMs);
        return Math.min(MAX_BACKOFF_MS, Math.max(exponential, requested));
    }
}
