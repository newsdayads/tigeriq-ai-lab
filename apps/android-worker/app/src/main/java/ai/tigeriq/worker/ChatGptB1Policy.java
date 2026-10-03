package ai.tigeriq.worker;

/** Pure policy for the ChatGPT B1 Project gate and pacing; Android-free for executable unit tests. */
public final class ChatGptB1Policy {
    public static final String REQUIRED_PROJECT = "TigerIQ AI Lab";
    public static final long MIN_FILL_TO_SEND_MS = 3000L;
    public static final long INTER_CYCLE_COOLDOWN_MS = 6000L;
    public static final int PROJECT_STABLE_MIN_SAMPLES = 3;
    public static final long PROJECT_STABLE_MIN_MS = 1200L;

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

    public static boolean shouldBindRequiredProjectFromStableContext(
        boolean active,
        boolean alreadyBound,
        String state,
        boolean chatGptPackage,
        boolean exactProjectLabelSeen,
        boolean projectTitleSignalSeen,
        boolean composerReady,
        int stableSamples,
        long stableMs
    ) {
        return active
            && !alreadyBound
            && "WAITING_PROJECT".equals(state)
            && chatGptPackage
            && exactProjectLabelSeen
            && projectTitleSignalSeen
            && composerReady
            && stableSamples >= PROJECT_STABLE_MIN_SAMPLES
            && stableMs >= PROJECT_STABLE_MIN_MS;
    }

    public static long nextActionAfterFill(long nowMs) {
        return nowMs + MIN_FILL_TO_SEND_MS;
    }

    public static long nextActionAfterCycle(long nowMs) {
        return nowMs + INTER_CYCLE_COOLDOWN_MS;
    }
}
