package ai.tigeriq.worker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ChatGptB1PolicyTest {
    @Test
    public void bindsOnlyFromRealChatGptClickOnExactRequiredProject() {
        assertTrue(ChatGptB1Policy.shouldBindRequiredProject(
            true, false, "WAITING_PROJECT", true, true, true
        ));

        assertFalse(ChatGptB1Policy.shouldBindRequiredProject(
            true, false, "WAITING_PROJECT", true, false, true
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProject(
            true, false, "WAITING_PROJECT", true, true, false
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProject(
            true, false, "WAITING_PROJECT", false, true, true
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProject(
            true, false, "REQUESTED", true, true, true
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProject(
            true, true, "WAITING_PROJECT", true, true, true
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProject(
            false, false, "WAITING_PROJECT", true, true, true
        ));
    }

    @Test
    public void boundsProjectBindingWithMonotonicElapsedTime() {
        long startedElapsed = 1_000_000L;
        assertFalse(ChatGptB1Policy.projectBindTimedOut(
            startedElapsed, startedElapsed + ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS - 1L
        ));
        assertTrue(ChatGptB1Policy.projectBindTimedOut(
            startedElapsed, startedElapsed + ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS
        ));
        assertFalse(ChatGptB1Policy.projectBindTimedOut(
            0L, startedElapsed + ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS
        ));
        assertFalse(ChatGptB1Policy.projectBindTimedOut(
            startedElapsed + 10_000L, startedElapsed
        ));
        assertTrue(ChatGptB1Policy.projectBindElapsedAnchorInvalid(0L, startedElapsed));
        assertTrue(ChatGptB1Policy.projectBindElapsedAnchorInvalid(startedElapsed + 1L, startedElapsed));
        assertFalse(ChatGptB1Policy.projectBindElapsedAnchorInvalid(startedElapsed, startedElapsed));
        assertEquals(60_000L, ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS);
    }

    @Test
    public void timeoutRequiresCurrentBoundTaskIdentityAndWaitingState() {
        long start = 1_000_000L;
        long expired = start + ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS;
        assertTrue(ChatGptB1Policy.shouldTimeoutBoundTask(
            "run-1", "task-1", "run-1", "task-1", "WAITING_PROJECT", false, start, expired
        ));
        assertFalse(ChatGptB1Policy.shouldTimeoutBoundTask(
            "run-1", "task-1", "run-2", "task-1", "WAITING_PROJECT", false, start, expired
        ));
        assertFalse(ChatGptB1Policy.shouldTimeoutBoundTask(
            "run-1", "task-1", "run-1", "task-2", "WAITING_PROJECT", false, start, expired
        ));
        assertFalse(ChatGptB1Policy.shouldTimeoutBoundTask(
            "run-1", "task-1", "run-1", "task-1", "REQUESTED", false, start, expired
        ));
        assertFalse(ChatGptB1Policy.shouldTimeoutBoundTask(
            "run-1", "task-1", "run-1", "task-1", "WAITING_PROJECT", true, start, expired
        ));
    }

    @Test
    public void enablesStandaloneFallbackBeforeHardTimeout() {
        long start = 1_000_000L;
        assertFalse(ChatGptB1Policy.shouldUseStandaloneFallback(
            start, start + ChatGptB1Policy.STANDALONE_FALLBACK_AFTER_MS - 1L
        ));
        assertTrue(ChatGptB1Policy.shouldUseStandaloneFallback(
            start, start + ChatGptB1Policy.STANDALONE_FALLBACK_AFTER_MS
        ));
        assertFalse(ChatGptB1Policy.shouldUseStandaloneFallback(
            start, start + ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS
        ));
        assertEquals(20_000L, ChatGptB1Policy.STANDALONE_FALLBACK_AFTER_MS);
    }

    @Test
    public void coreTaskNeverFallsBackOrSendsOutsideVerifiedProject() {
        assertTrue(ChatGptB1Policy.canUseStandaloneFallbackForTask(""));
        assertTrue(ChatGptB1Policy.canUseStandaloneFallbackForTask(null));
        assertFalse(ChatGptB1Policy.canUseStandaloneFallbackForTask("MT-123"));

        assertTrue(ChatGptB1Policy.canExecuteCoreTaskInProjectContext("MT-123", "PROJECT"));
        assertFalse(ChatGptB1Policy.canExecuteCoreTaskInProjectContext("MT-123", "STANDALONE_FALLBACK"));
        assertFalse(ChatGptB1Policy.canExecuteCoreTaskInProjectContext("MT-123", "WAITING_PROJECT"));
        assertFalse(ChatGptB1Policy.canExecuteCoreTaskInProjectContext("MT-123", null));
        assertTrue(ChatGptB1Policy.canExecuteCoreTaskInProjectContext("", "STANDALONE_FALLBACK"));
    }

    @Test
    public void leasedCoreTaskRevalidatesLiveProjectBeforeComposerMutation() {
        assertTrue(ChatGptB1Policy.canMutateComposerInLiveProjectContext(
            "MT-123", "PROJECT", true, true, true
        ));
        // Persisted projectBound does not protect against a user changing chats.
        assertFalse(ChatGptB1Policy.canMutateComposerInLiveProjectContext(
            "MT-123", "PROJECT", true, false, true
        ));
        assertFalse(ChatGptB1Policy.canMutateComposerInLiveProjectContext(
            "MT-123", "PROJECT", true, true, false
        ));
        assertFalse(ChatGptB1Policy.canMutateComposerInLiveProjectContext(
            "MT-123", "PROJECT", false, true, true
        ));
        assertFalse(ChatGptB1Policy.canMutateComposerInLiveProjectContext(
            "MT-123", "STANDALONE_FALLBACK", true, true, true
        ));
        assertFalse(ChatGptB1Policy.canMutateComposerInLiveProjectContext(
            "MT-123", null, true, true, true
        ));
        // Preserve the explicitly separate manual B1 fallback contract.
        assertTrue(ChatGptB1Policy.canMutateComposerInLiveProjectContext(
            "", "STANDALONE_FALLBACK", true, false, true
        ));
        assertTrue(ChatGptB1Policy.canMutateComposerInLiveProjectContext(
            null, null, false, false, false
        ));
    }

    @Test
    public void coreTokenFromOtherChatCannotCompleteProjectTask() {
        assertTrue(ChatGptB1Policy.canAcceptResponseInLiveProjectContext(
            "MT-123", "PROJECT", true, true
        ));
        // The token exists, but the person navigated away from the Project.
        assertFalse(ChatGptB1Policy.canAcceptResponseInLiveProjectContext(
            "MT-123", "PROJECT", true, false
        ));
        assertFalse(ChatGptB1Policy.canAcceptResponseInLiveProjectContext(
            "MT-123", "PROJECT", false, true
        ));
        assertFalse(ChatGptB1Policy.canAcceptResponseInLiveProjectContext(
            "MT-123", "STANDALONE_FALLBACK", true, true
        ));
        assertFalse(ChatGptB1Policy.canAcceptResponseInLiveProjectContext(
            "MT-123", null, true, true
        ));
        // Only Core-leased tasks are pinned to the verified Project.
        assertTrue(ChatGptB1Policy.canAcceptResponseInLiveProjectContext(
            "", "STANDALONE_FALLBACK", true, false
        ));
        assertTrue(ChatGptB1Policy.canAcceptResponseInLiveProjectContext(
            null, null, false, false
        ));
    }

    @Test
    public void sendAttemptRequiresInputReadyAndUnclaimedCycle() {
        assertTrue(ChatGptB1Policy.canClaimSendAttempt("INPUT_READY", 1, 0));
        assertTrue(ChatGptB1Policy.canClaimSendAttempt("INPUT_READY", 2, 1));
        // The claim is durable before ACTION_CLICK; retries and stale states must be refused.
        assertFalse(ChatGptB1Policy.canClaimSendAttempt("INPUT_READY", 1, 1));
        assertFalse(ChatGptB1Policy.canClaimSendAttempt("WAITING_AI", 1, 1));
        assertFalse(ChatGptB1Policy.canClaimSendAttempt("REQUESTED", 1, 0));
        assertFalse(ChatGptB1Policy.canClaimSendAttempt("VERIFYING_CONTEXT", 1, 0));
        assertFalse(ChatGptB1Policy.canClaimSendAttempt("INPUT_READY", 0, 0));
        assertFalse(ChatGptB1Policy.canClaimSendAttempt(null, 1, 0));
    }

    @Test
    public void projectGateEvidenceIsFreshEnumOnlyAndNeverRawUiText() {
        assertEquals("CONTEXT_WAIT", ChatGptB1Policy.safeProjectGateModeForEvidence(
            "CONTEXT_WAIT", 1_100L, 1_000L
        ));
        assertEquals("STABLE_PROJECT_CONTEXT", ChatGptB1Policy.safeProjectGateModeForEvidence(
            "STABLE_PROJECT_CONTEXT", 1_000L, 1_000L
        ));
        // Modes from a previous task must never describe the current lease.
        assertEquals("UNAVAILABLE", ChatGptB1Policy.safeProjectGateModeForEvidence(
            "CONTEXT_WAIT", 999L, 1_000L
        ));
        assertEquals("UNAVAILABLE", ChatGptB1Policy.safeProjectGateModeForEvidence(
            "CONTEXT_WAIT", 0L, 1_000L
        ));
        assertEquals("UNAVAILABLE", ChatGptB1Policy.safeProjectGateModeForEvidence(
            "CONTEXT_WAIT", 1_001L, 0L
        ));
        // A diagnostic string must not become an arbitrary transport for
        // sensitive Accessibility labels, user text or credentials.
        assertEquals("UNAVAILABLE", ChatGptB1Policy.safeProjectGateModeForEvidence(
            "CONTEXT_WAIT: message body", 1_001L, 1_000L
        ));
        assertEquals("UNAVAILABLE", ChatGptB1Policy.safeProjectGateModeForEvidence(
            null, 1_001L, 1_000L
        ));
        assertTrue(ChatGptB1Policy.projectClickObservedInRun(1_100L, 1_000L));
        assertFalse(ChatGptB1Policy.projectClickObservedInRun(999L, 1_000L));
        assertFalse(ChatGptB1Policy.projectClickObservedInRun(1_100L, 0L));
    }

    @Test
    public void invisibleProjectTitleCannotProveLiveProjectContext() {
        assertTrue(ChatGptB1Policy.isVisibleNonNavigationProjectTitle(
            true, true, false
        ));
        // A hidden semantic Project node is not proof of the current chat.
        assertFalse(ChatGptB1Policy.isVisibleNonNavigationProjectTitle(
            true, false, false
        ));
        // Visible Project labels inside navigation drawers are also rejected.
        assertFalse(ChatGptB1Policy.isVisibleNonNavigationProjectTitle(
            true, true, true
        ));
        assertFalse(ChatGptB1Policy.isVisibleNonNavigationProjectTitle(
            false, true, false
        ));
    }

    @Test
    public void projectClickAloneCannotBypassStableTitleAndComposerGate() {
        assertTrue(ChatGptB1Policy.canBindStableProjectContext(
            true, true, true, 3, 1200L
        ));
        // A Project link in a clickable menu (even after an auto-click)
        // does not prove that the user is inside the Project conversation.
        assertFalse(ChatGptB1Policy.canBindStableProjectContext(
            true, false, true, 3, 1200L
        ));
        assertFalse(ChatGptB1Policy.canBindStableProjectContext(
            true, true, false, 3, 1200L
        ));
        assertFalse(ChatGptB1Policy.canBindStableProjectContext(
            false, true, true, 3, 1200L
        ));
        assertFalse(ChatGptB1Policy.canBindStableProjectContext(
            true, true, true, 2, 1200L
        ));
        assertFalse(ChatGptB1Policy.canBindStableProjectContext(
            true, true, true, 3, 1199L
        ));
    }

    @Test
    public void coreResultAcceptanceRequiresProjectProofAndExactlyOneSend() {
        assertTrue(ChatGptB1Policy.canAcceptCoreTaskCompletion(
            "COMPLETE", true, "PROJECT", 1, 0
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreTaskCompletion(
            "COMPLETE", false, "PROJECT", 1, 0
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreTaskCompletion(
            "COMPLETE", true, "STANDALONE_FALLBACK", 1, 0
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreTaskCompletion(
            "COMPLETE", true, "WAITING_PROJECT", 1, 0
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreTaskCompletion(
            "COMPLETE", true, null, 1, 0
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreTaskCompletion(
            "COMPLETE", true, "PROJECT", 0, 0
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreTaskCompletion(
            "COMPLETE", true, "PROJECT", 2, 0
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreTaskCompletion(
            "COMPLETE", true, "PROJECT", 1, 1
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreTaskCompletion(
            "ERROR", true, "PROJECT", 1, 0
        ));
    }

    @Test
    public void enforcesFillAndInterCyclePacing() {
        long now = 1_000_000L;
        assertEquals(now + 5000L, ChatGptB1Policy.nextActionAfterFill(now));
        assertEquals(now + 8000L, ChatGptB1Policy.nextActionAfterCycle(now));
        assertEquals(5000L, ChatGptB1Policy.MIN_FILL_TO_SEND_MS);
        assertEquals(8000L, ChatGptB1Policy.INTER_CYCLE_COOLDOWN_MS);
    }
}
