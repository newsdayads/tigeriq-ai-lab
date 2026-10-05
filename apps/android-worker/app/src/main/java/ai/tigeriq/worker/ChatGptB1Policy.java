package ai.tigeriq.worker;

/** Pure policy for the ChatGPT B1 Project gate and pacing; Android-free for executable unit tests. */
public final class ChatGptB1Policy {
    public static final String REQUIRED_PROJECT = "TigerIQ AI Lab";
    public static final long MIN_FILL_TO_SEND_MS = 5000L;
    public static final long INTER_CYCLE_COOLDOWN_MS = 8000L;
    public static final long PROJECT_NAV_STEP_MS = 2500L;
    public static final long PROJECT_NAV_RETRY_MS = 3000L;
    public static final long STANDALONE_FALLBACK_AFTER_MS = 20_000L;
    public static final long PROJECT_BIND_TIMEOUT_MS = 60_000L;

    private ChatGptB1Policy() {}

    public static boolean shouldBindRequiredProject(
        boolean active,
        boolean alreadyBound,
        String state,
        boolean chatGptPackage,
        boolean clickedEvent,
        boolean exactProjectLabelSeen
    ) {
        return active
            && !alreadyBound
            && "WAITING_PROJECT".equals(state)
            && chatGptPackage
            && clickedEvent
            && exactProjectLabelSeen;
    }

    public static boolean projectBindElapsedAnchorInvalid(long startedElapsedMs, long nowElapsedMs) {
        return startedElapsedMs <= 0L || nowElapsedMs < startedElapsedMs;
    }

    public static boolean shouldUseStandaloneFallback(long startedElapsedMs, long nowElapsedMs) {
        return !projectBindElapsedAnchorInvalid(startedElapsedMs, nowElapsedMs)
            && nowElapsedMs - startedElapsedMs >= STANDALONE_FALLBACK_AFTER_MS
            && nowElapsedMs - startedElapsedMs < PROJECT_BIND_TIMEOUT_MS;
    }

    public static boolean projectBindTimedOut(long startedElapsedMs, long nowElapsedMs) {
        return !projectBindElapsedAnchorInvalid(startedElapsedMs, nowElapsedMs)
            && nowElapsedMs - startedElapsedMs >= PROJECT_BIND_TIMEOUT_MS;
    }

    public static boolean shouldTimeoutBoundTask(
        String expectedRunId,
        String expectedTaskId,
        String currentRunId,
        String currentTaskId,
        String state,
        boolean projectBound,
        long startedElapsedMs,
        long nowElapsedMs
    ) {
        return expectedRunId != null
            && expectedTaskId != null
            && expectedRunId.equals(currentRunId)
            && expectedTaskId.equals(currentTaskId)
            && "WAITING_PROJECT".equals(state)
            && !projectBound
            && projectBindTimedOut(startedElapsedMs, nowElapsedMs);
    }

    public static long nextActionAfterFill(long nowMs) {
        return nowMs + MIN_FILL_TO_SEND_MS;
    }

    public static long nextActionAfterCycle(long nowMs) {
        return nowMs + INTER_CYCLE_COOLDOWN_MS;
    }
}
