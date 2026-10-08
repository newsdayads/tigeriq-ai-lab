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

    /**
     * Check LIVE context again before touching a composer or Send control.
     * A prior persisted Project binding is not proof that the current chat
     * still belongs to the pinned Project. Manual B1 flows are unchanged.
     */
    public static boolean canMutateComposerInLiveProjectContext(
        String taskId, String projectMode, boolean projectBound,
        boolean liveProjectTitle, boolean composerReady
    ) {
        return (taskId == null || taskId.isEmpty())
            || (projectBound
                && "PROJECT".equals(projectMode)
                && liveProjectTitle
                && composerReady);
    }

    /** A Core-leased task pinned to the TigerIQ Project must never fall back to standalone chat. */
    public static boolean canUseStandaloneFallbackForTask(String taskId) {
        return taskId == null || taskId.isEmpty();
    }

    /** Reject success or message sending from a Core task outside its verified Project. */
    public static boolean canExecuteCoreTaskInProjectContext(String taskId, String projectMode) {
        return (taskId == null || taskId.isEmpty()) || "PROJECT".equals(projectMode);
    }

    /**
     * A Core task is accepted only when the persisted result proves Project context
     * and exactly one send. A response token alone is not sufficient evidence.
     */
    public static boolean canAcceptCoreTaskCompletion(
        String runState, boolean projectBound, String projectMode,
        int sendCount, int duplicateSendCount
    ) {
        return "COMPLETE".equals(runState)
            && projectBound
            && "PROJECT".equals(projectMode)
            && sendCount == 1
            && duplicateSendCount == 0;
    }

    /**
     * A Project-label click is only navigation evidence, never proof of a ready
     * Project conversation. Require a stable Project title outside clickable
     * navigation and a real composer before accepting the Project binding.
     */
    public static boolean canBindStableProjectContext(
        boolean exactProjectVisible, boolean projectTitleContext,
        boolean composerReady, int stableSamples, long stableMs
    ) {
        return exactProjectVisible
            && projectTitleContext
            && composerReady
            && stableSamples >= 3
            && stableMs >= 1200L;
    }

    /**
     * Permit at most one durable send attempt for each cycle. This gate is
     * evaluated before dispatching the irreversible accessibility click.
     */
    public static boolean canClaimSendAttempt(String state, int cycle, int sentCycle) {
        return "INPUT_READY".equals(state) && cycle > 0 && sentCycle != cycle;
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
