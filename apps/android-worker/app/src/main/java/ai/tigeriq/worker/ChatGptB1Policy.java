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

    /**
     * Matching a token elsewhere in ChatGPT is not a Core task receipt.
     * Revalidate the live pinned-Project title before accepting the response.
     * Keep the independent manual B1 acceptance path unchanged.
     */
    public static boolean canAcceptResponseInLiveProjectContext(
        String taskId, String projectMode, boolean projectBound,
        boolean liveProjectTitle
    ) {
        return (taskId == null || taskId.isEmpty())
            || (projectBound
                && "PROJECT".equals(projectMode)
                && liveProjectTitle);
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
     * Structural message-role evidence only. Never infer sender identity from
     * user-controlled text or content descriptions. Unsupported native UI
     * hierarchies intentionally return UNKNOWN and cannot complete Core tasks.
     */
    public static String structuralMessageRole(String className, String viewId) {
        String structure = (String.valueOf(className) + " " + String.valueOf(viewId))
            .toLowerCase(java.util.Locale.ROOT);
        boolean assistant = structure.contains("assistant_message")
            || structure.contains("message_assistant")
            || structure.contains("assistant_response")
            || structure.contains("response_assistant")
            || structure.contains("bot_message")
            || structure.contains("message_bot");
        boolean user = structure.contains("user_message")
            || structure.contains("message_user")
            || structure.contains("human_message")
            || structure.contains("message_human");
        if (assistant == user) return "UNKNOWN";
        return assistant ? "ASSISTANT" : "USER";
    }

    /**
     * Testable, platform-independent Core transcript receipt matcher.
     *
     * Accessibility evidence is fed only after structural role validation.
     * A stale assistant token before the current prompt poisons the receipt;
     * duplicated identical user prompts are likewise ambiguous. Never infer
     * sender or creation time from token-bearing user-controlled text.
     */
    public static final class CoreReplyMatcher {
        private final String prompt;
        private final String token;
        private final boolean durableSendClaim;
        private int matchingUserPrompts;
        private boolean assistantTokenBeforePrompt;
        private boolean assistantTokenSeen;
        private String candidate = "";

        public CoreReplyMatcher(String prompt, String token, boolean durableSendClaim) {
            this.prompt = prompt == null ? "" : prompt.trim();
            this.token = token == null ? "" : token.trim();
            this.durableSendClaim = durableSendClaim;
        }

        public void observe(String role, String message) {
            if (role == null || message == null || prompt.isEmpty() || token.isEmpty()) return;
            String raw = message.trim();
            if ("USER".equals(role) && raw.equals(prompt)) {
                matchingUserPrompts++;
                return;
            }
            if (!"ASSISTANT".equals(role)
                || !containsExactCoreToken(raw, token)) return;
            assistantTokenSeen = true;
            if (matchingUserPrompts == 0) {
                assistantTokenBeforePrompt = true;
                return;
            }
            if (canAcceptCoreResponseEvidence(role, matchingUserPrompts == 1, durableSendClaim)
                && candidate.isEmpty()) candidate = raw;
        }

        public String verifiedReply() {
            if (assistantTokenBeforePrompt || matchingUserPrompts != 1
                || !durableSendClaim) return "";
            if (candidate.length() > 4000) return candidate.substring(0, 4000);
            return candidate;
        }

        public boolean hasPreexistingTaskTranscript() {
            return matchingUserPrompts > 0 || assistantTokenSeen;
        }
    }

    /**
     * Core confirmation token is an exact case-sensitive ASCII identifier,
     * not a substring or a case-folded approximation of another identifier.
     * Letters, digits, underscores, hyphens and dots cannot adjoin the token.
     */
    public static boolean containsExactCoreToken(String message, String token) {
        if (message == null || token == null || token.isEmpty()) return false;
        int from = 0;
        while (from <= message.length() - token.length()) {
            int pos = message.indexOf(token, from);
            if (pos < 0) return false;
            int end = pos + token.length();
            boolean before = pos > 0 && isCoreTokenCharacter(message.charAt(pos - 1));
            boolean after = end < message.length() && isCoreTokenCharacter(message.charAt(end));
            if (!before && !after) return true;
            from = pos + 1;
        }
        return false;
    }

    private static boolean isCoreTokenCharacter(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '-' || c == '.';
    }

    /**
     * Core receipt eligibility must be checked BEFORE reading any candidate
     * token. A late response or an in-flight stream cannot be marked COMPLETE.
     * For unknown/reversed wall clocks, fail closed until a safe retry/error.
     */
    public static boolean canAcceptCoreReplyWithinWindow(
        long sentAtMs, long nowMs, long timeoutMs, boolean generationInProgress
    ) {
        return sentAtMs > 0L
            && nowMs >= sentAtMs
            && timeoutMs > 0L
            && nowMs - sentAtMs <= timeoutMs
            && !generationInProgress;
    }

    /**
     * An INPUT_READY snapshot does not prove that the live composer still holds
     * this leased task's exact prompt. Fail closed on cleared, replaced, or
     * unavailable composer text immediately before the irreversible send.
     */
    public static boolean canSendCorePromptFromLiveComposer(
        String runState, String expectedPrompt, String liveComposerText,
        boolean visible, boolean editable
    ) {
        return "INPUT_READY".equals(runState)
            && expectedPrompt != null
            && !expectedPrompt.isEmpty()
            && expectedPrompt.equals(liveComposerText)
            && visible
            && editable;
    }

    /**
     * Refuse a stale Accessibility callback when the durable Core run has
     * changed since its snapshot. Identity and prompt are checked under the
     * RunStore synchronized claim, before its irreversible send claim.
     */
    public static boolean canClaimCoreSendForSnapshot(
        String expectedRunId, String expectedTaskId, int expectedCycle,
        String expectedPrompt, String liveRunId, String liveTaskId,
        int liveCycle, String liveState, int liveSentCycle,
        String livePrompt, boolean projectBound, String projectMode
    ) {
        return expectedRunId != null && !expectedRunId.isEmpty()
            && expectedTaskId != null && !expectedTaskId.isEmpty()
            && expectedPrompt != null && !expectedPrompt.isEmpty()
            && expectedRunId.equals(liveRunId)
            && expectedTaskId.equals(liveTaskId)
            && expectedCycle > 0 && expectedCycle == liveCycle
            && expectedPrompt.equals(livePrompt)
            && projectBound && "PROJECT".equals(projectMode)
            && canClaimSendAttempt(liveState, liveCycle, liveSentCycle);
    }

    /**
     * A response observed for one run may never complete a replaced lease.
     * Check again under the RunStore synchronized finalization boundary.
     */
    public static boolean canCompleteCoreReplyForSnapshot(
        String expectedRunId, String expectedTaskId, int expectedCycle,
        String expectedToken, String reply, String liveRunId, String liveTaskId,
        int liveCycle, String liveState, int liveSentCycle,
        int sendCount, int duplicateSendCount,
        String liveToken, boolean projectBound, String projectMode
    ) {
        return expectedRunId != null && !expectedRunId.isEmpty()
            && expectedTaskId != null && !expectedTaskId.isEmpty()
            && expectedToken != null && !expectedToken.isEmpty()
            && expectedRunId.equals(liveRunId)
            && expectedTaskId.equals(liveTaskId)
            && expectedCycle > 0 && expectedCycle == liveCycle
            && "WAITING_AI".equals(liveState)
            && liveSentCycle == liveCycle
            && sendCount == 1 && duplicateSendCount == 0
            && expectedToken.equals(liveToken)
            && projectBound && "PROJECT".equals(projectMode)
            && containsExactCoreToken(reply, expectedToken);
    }

    /**
     * Accessibility callbacks can arrive after a lease is replaced. All
     * Core-only status writes must compare the observed run identity against
     * the live active run and permit only the expected source state.
     */
    public static boolean canMutateObservedCoreRun(
        String observedRunId, String observedTaskId, int observedCycle,
        String liveRunId, String liveTaskId, int liveCycle,
        String liveState, String... allowedStates
    ) {
        if (observedRunId == null || observedRunId.isEmpty()
            || observedTaskId == null || observedTaskId.isEmpty()
            || liveRunId == null || liveTaskId == null
            || observedCycle <= 0 || observedCycle != liveCycle
            || !observedRunId.equals(liveRunId)
            || !observedTaskId.equals(liveTaskId)
            || allowedStates == null) return false;
        for (String allowed : allowedStates) {
            if (allowed != null && allowed.equals(liveState)) return true;
        }
        return false;
    }

    /**
     * Delayed manual B1 recovery callbacks must never act on a replacement
     * Core lease (or a different manual run). Task-id must remain empty.
     * An observed cycle and start timestamp prevent reusing stale identity.
     */
    public static boolean canMutateObservedManualRun(
        String expectedRunId, int expectedCycle, long expectedStartedAt,
        String liveRunId, String liveTaskId, int liveCycle,
        long liveStartedAt, String liveState
    ) {
        return expectedRunId != null && !expectedRunId.isEmpty()
            && expectedCycle > 0 && expectedStartedAt > 0L
            && expectedRunId.equals(liveRunId)
            && liveTaskId != null && liveTaskId.isEmpty()
            && expectedCycle == liveCycle
            && expectedStartedAt == liveStartedAt
            && ("WAITING_PROJECT".equals(liveState)
                || "REQUESTED".equals(liveState)
                || "VERIFYING_CONTEXT".equals(liveState)
                || "INPUT_READY".equals(liveState)
                || "WAITING_AI".equals(liveState));
    }

    /**
     * Once the last recovery launch has had a full grace timer to foreground
     * ChatGPT, report a terminal Core error rather than leaving a leased
     * task active with no further recovery or evidence.
     */
    public static boolean canFailExhaustedCoreRecoveryForSnapshot(
        String scheduledRunId, String scheduledTaskId, int scheduledCycle,
        String liveRunId, String liveTaskId, int liveCycle,
        String liveState, int liveRecoveryCount, int maxRecoveries
    ) {
        return maxRecoveries > 0 && liveRecoveryCount >= maxRecoveries
            && canMutateObservedCoreRun(
                scheduledRunId, scheduledTaskId, scheduledCycle,
                liveRunId, liveTaskId, liveCycle, liveState,
                "WAITING_PROJECT", "REQUESTED", "VERIFYING_CONTEXT",
                "INPUT_READY", "WAITING_AI"
            );
    }

    /**
     * Reacquire a scheduled Core recovery only for the same active run and
     * while its recovery budget remains. A stale 2.5s callback must not
     * increment a replacement lease's recovery count or launch its provider.
     */
    public static boolean canClaimCoreRecoveryForSnapshot(
        String scheduledRunId, String scheduledTaskId, int scheduledCycle,
        String liveRunId, String liveTaskId, int liveCycle,
        String liveState, int liveRecoveryCount, int maxRecoveries
    ) {
        return maxRecoveries > 0 && liveRecoveryCount >= 0
            && liveRecoveryCount < maxRecoveries
            && canMutateObservedCoreRun(
                scheduledRunId, scheduledTaskId, scheduledCycle,
                liveRunId, liveTaskId, liveCycle, liveState,
                "WAITING_PROJECT", "REQUESTED", "VERIFYING_CONTEXT",
                "INPUT_READY", "WAITING_AI"
            );
    }

    /**
     * Stable Project-context evidence belongs to one durable Core run only.
     * The final Project-binding commit must still see that exact run waiting.
     */
    public static boolean canBindObservedCoreProject(
        String observedRunId, String observedTaskId, int observedCycle,
        String liveRunId, String liveTaskId, int liveCycle,
        String liveState, boolean liveProjectBound
    ) {
        return !liveProjectBound
            && canMutateObservedCoreRun(
                observedRunId, observedTaskId, observedCycle,
                liveRunId, liveTaskId, liveCycle, liveState, "WAITING_PROJECT"
            );
    }

    /** A stable sample from another lease must not count for this run. */
    public static boolean isSameProjectContextCandidate(
        String candidateRunId, String candidateTaskId, int candidateCycle,
        String currentRunId, String currentTaskId, int currentCycle
    ) {
        return candidateRunId != null && !candidateRunId.isEmpty()
            && currentRunId != null && candidateRunId.equals(currentRunId)
            && candidateTaskId != null && currentTaskId != null
            && candidateTaskId.equals(currentTaskId)
            && candidateCycle > 0 && candidateCycle == currentCycle;
    }

    /**
     * A recent Project click is only Core navigation proof if it came from the
     * exact same durable run/task/cycle. Timestamps alone are not identity.
     */
    public static boolean isCoreProjectClickProofForRun(
        String expectedRunId, String expectedTaskId, int expectedCycle,
        long runStartedAt, String clickedRunId, String clickedTaskId,
        int clickedCycle, long clickAt
    ) {
        return projectClickObservedInRun(clickAt, runStartedAt)
            && isSameProjectContextCandidate(
                clickedRunId, clickedTaskId, clickedCycle,
                expectedRunId, expectedTaskId, expectedCycle
            );
    }

    /**
     * A Core task may click Send only when the action itself has a trusted
     * native button identity in the local composer scope. Do not accept the
     * word "send" in arbitrary message text or guess from an icon's shape.
     */
    public static boolean isTrustedCoreSendControl(
        boolean visible, boolean enabled, boolean clickable,
        String className, String viewId, String contentDescription
    ) {
        if (!visible || !enabled || !clickable) return false;
        String klass = className == null ? "" : className.toLowerCase(java.util.Locale.ROOT);
        boolean button = klass.contains("button");
        if (!button) return false;
        String id = viewId == null ? "" : viewId.toLowerCase(java.util.Locale.ROOT);
        int slash = id.lastIndexOf('/');
        if (slash >= 0) id = id.substring(slash + 1);
        boolean exactSendId = id.equals("send_button")
            || id.equals("send_message_button")
            || id.equals("composer_send")
            || id.equals("composer_send_button")
            || id.equals("chat_send_button");
        String desc = contentDescription == null
            ? "" : contentDescription.trim().toLowerCase(java.util.Locale.ROOT);
        boolean exactSendDescription = desc.equals("send")
            || desc.equals("send message")
            || desc.equals("gửi")
            || desc.equals("gửi tin nhắn");
        return exactSendId || exactSendDescription;
    }

    /** A token alone cannot establish the sender or freshness of a Core reply. */
    public static boolean canAcceptCoreResponseEvidence(
        String senderRole, boolean sentPromptSeen, boolean durableSendClaim
    ) {
        return "ASSISTANT".equals(senderRole) && sentPromptSeen && durableSendClaim;
    }

    /**
     * A matching clickable chat quote is not a Project selector. Require
     * verified ancestry inside a semantic navigation drawer/projects list,
     * excluding all conversation/message/composer subtrees. No coordinate
     * heuristic or clickable-label-only fallback.
     */
    public static boolean isTrustedProjectNavigationTarget(
        boolean enabledClickableTarget, boolean exactProjectLabel,
        boolean navigationScope, boolean conversationScope,
        boolean completeAncestry
    ) {
        return enabledClickableTarget
            && exactProjectLabel
            && navigationScope
            && !conversationScope
            && completeAncestry;
    }

    /**
     * A Project title copied into a chat bubble cannot authenticate context.
     * Trust ONLY a visible exact label inside an explicitly identified toolbar
     * hierarchy, with no scrollable conversation or clickable navigation
     * ancestor and a complete ancestry up to the active root. This deliberately
     * fails closed when ChatGPT supplies no structural toolbar semantics.
     *
     * No coordinates, gestures or physical S10 acceptance are inferred here.
     */
    public static boolean isVerifiedProjectHeaderEvidence(
        boolean exactVisibleLabel,
        boolean semanticToolbarAncestor,
        boolean scrollOrMessageAncestor,
        boolean clickableAncestor,
        boolean completeAncestry
    ) {
        return exactVisibleLabel
            && semanticToolbarAncestor
            && !scrollOrMessageAncestor
            && !clickableAncestor
            && completeAncestry;
    }

    /**
     * Accessibility may expose an exact Project title even when its node is
     * hidden/off-screen. Never use an invisible or clickable-navigation title
     * as live context proof for a Core task.
     */
    public static boolean isVisibleNonNavigationProjectTitle(
        boolean exactLabel, boolean visibleToUser, boolean clickableAncestor
    ) {
        return exactLabel && visibleToUser && !clickableAncestor;
    }

    /**
     * Expose only a bounded, fresh diagnostic mode. Accessibility text and
     * raw node lineage can include user content and MUST NOT leave the device.
     * Older modes left in SharedPreferences by another run are not evidence.
     */
    public static String safeProjectGateModeForEvidence(
        String mode, long observedAt, long runStartedAt
    ) {
        if (observedAt <= 0L || runStartedAt <= 0L || observedAt < runStartedAt) {
            return "UNAVAILABLE";
        }
        if (mode == null) return "UNAVAILABLE";
        switch (mode) {
            case "DIRECT_LINEAGE":
            case "LOCAL_CLICKABLE_SCOPE":
            case "CLICK_REJECTED":
            case "AUTO_PROJECT_CLICK":
            case "AUTO_MENU_CLICK":
            case "AUTO_MENU_CLICK_FAILED":
            case "AUTO_NAV_WAIT":
            case "CONTEXT_WAIT":
            case "CONTEXT_CANDIDATE":
            case "STABLE_PROJECT_CONTEXT":
            case "STANDALONE_WAIT_NEW_CHAT":
            case "STANDALONE_NEW_CHAT_CLICK":
            case "STANDALONE_NEW_CHAT_CLICK_FAILED":
            case "STANDALONE_WAIT_COMPOSER":
            case "STANDALONE_FALLBACK_READY":
                return mode;
            default:
                return "UNAVAILABLE";
        }
    }

    public static boolean projectClickObservedInRun(long lastClickAt, long runStartedAt) {
        return runStartedAt > 0L && lastClickAt >= runStartedAt;
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
     * A regular conversation can be named exactly like the required Project.
     * For a Core lease, header + composer must be backed by a Project
     * navigation action observed during THIS run. Manual standalone B1 retains
     * its prior policy. Navigation alone is still insufficient: stable
     * semantic header and composer evidence must independently pass.
     */
    public static boolean canBindStableProjectContextForTask(
        String taskId, boolean exactProjectVisible, boolean projectTitleContext,
        boolean composerReady, boolean projectNavigationObservedInRun,
        int stableSamples, long stableMs
    ) {
        boolean navRequired = taskId != null && !taskId.isEmpty();
        return (!navRequired || projectNavigationObservedInRun)
            && canBindStableProjectContext(
                exactProjectVisible, projectTitleContext, composerReady,
                stableSamples, stableMs
            );
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
