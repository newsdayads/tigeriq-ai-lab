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
    public void coreReplyRequiresTrustedAssistantRoleAfterSentPrompt() {
        // A user can quote or type the same expected token: never count it.
        assertEquals("USER", ChatGptB1Policy.structuralMessageRole(
            "android.view.View", "chat_user_message"
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreResponseEvidence(
            "USER", true, true
        ));
        // Editable composer and generic transcript text have no trusted role.
        assertEquals("UNKNOWN", ChatGptB1Policy.structuralMessageRole(
            "android.widget.EditText", "composer"
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreResponseEvidence(
            "UNKNOWN", true, true
        ));
        // Old assistant replies before the newly sent prompt are not fresh.
        assertEquals("ASSISTANT", ChatGptB1Policy.structuralMessageRole(
            "android.view.View", "chat_message_assistant"
        ));
        assertFalse(ChatGptB1Policy.canAcceptCoreResponseEvidence(
            "ASSISTANT", false, true
        ));
        // No durable send claim means no new response can be accepted.
        assertFalse(ChatGptB1Policy.canAcceptCoreResponseEvidence(
            "ASSISTANT", true, false
        ));
        // App-owned assistant role AFTER current prompt and send claim.
        assertTrue(ChatGptB1Policy.canAcceptCoreResponseEvidence(
            "ASSISTANT", true, true
        ));
        // Conflicting role indicators must fail closed, not guess.
        assertEquals("UNKNOWN", ChatGptB1Policy.structuralMessageRole(
            "user_message", "assistant_message"
        ));
        // Spoofed role in text/description is never consulted.
        assertEquals("UNKNOWN", ChatGptB1Policy.structuralMessageRole(
            "android.view.View", "message_text"
        ));
    }

    @Test
    public void coreReplyMatcherAcceptsOnlyCurrentPromptThenAttributedAssistant() {
        ChatGptB1Policy.CoreReplyMatcher valid =
            new ChatGptB1Policy.CoreReplyMatcher("RUN-44 prompt", "CORE_OK_44", true);
        valid.observe("UNKNOWN", "CORE_OK_44 spoofed composer");
        valid.observe("USER", "CORE_OK_44 quoted in another user message");
        assertEquals("", valid.verifiedReply());
        valid.observe("USER", "RUN-44 prompt");
        valid.observe("ASSISTANT", "Verified: CORE_OK_44, finished");
        assertEquals("Verified: CORE_OK_44, finished", valid.verifiedReply());

        ChatGptB1Policy.CoreReplyMatcher stale =
            new ChatGptB1Policy.CoreReplyMatcher("RUN-44 prompt", "CORE_OK_44", true);
        stale.observe("ASSISTANT", "Old CORE_OK_44 response");
        stale.observe("USER", "RUN-44 prompt");
        stale.observe("ASSISTANT", "New CORE_OK_44 response");
        assertEquals("Stale token before prompt poisons acceptance", "", stale.verifiedReply());

        ChatGptB1Policy.CoreReplyMatcher duplicated =
            new ChatGptB1Policy.CoreReplyMatcher("RUN-44 prompt", "CORE_OK_44", true);
        duplicated.observe("USER", "RUN-44 prompt");
        duplicated.observe("ASSISTANT", "CORE_OK_44");
        duplicated.observe("USER", "RUN-44 prompt");
        assertEquals("Two identical prompts cannot prove which response is current",
            "", duplicated.verifiedReply());

        ChatGptB1Policy.CoreReplyMatcher noDurableSend =
            new ChatGptB1Policy.CoreReplyMatcher("RUN-44 prompt", "CORE_OK_44", false);
        noDurableSend.observe("USER", "RUN-44 prompt");
        noDurableSend.observe("ASSISTANT", "CORE_OK_44");
        assertEquals("", noDurableSend.verifiedReply());
    }

    @Test
    public void projectBindingRequiresExactWaitingCoreLease() {
        assertTrue(ChatGptB1Policy.canBindObservedCoreProject(
            "run-1", "task-1", 1, "run-1", "task-1", 1, "WAITING_PROJECT", false
        ));
        assertFalse("Cannot bind Project for a different run",
            ChatGptB1Policy.canBindObservedCoreProject(
                "run-1", "task-1", 1, "run-2", "task-1", 1, "WAITING_PROJECT", false
            ));
        assertFalse("Cannot bind Project for a different task",
            ChatGptB1Policy.canBindObservedCoreProject(
                "run-1", "task-1", 1, "run-1", "task-2", 1, "WAITING_PROJECT", false
            ));
        assertFalse("Cannot bind Project for a different cycle",
            ChatGptB1Policy.canBindObservedCoreProject(
                "run-1", "task-1", 1, "run-1", "task-1", 2, "WAITING_PROJECT", false
            ));
        assertFalse("Cannot resurrect a completed run as Project-bound",
            ChatGptB1Policy.canBindObservedCoreProject(
                "run-1", "task-1", 1, "run-1", "task-1", 1, "COMPLETE", false
            ));
        assertFalse("Cannot reset a sent run to REQUESTED",
            ChatGptB1Policy.canBindObservedCoreProject(
                "run-1", "task-1", 1, "run-1", "task-1", 1, "WAITING_AI", false
            ));
        assertFalse("Already bound Project must not be reset",
            ChatGptB1Policy.canBindObservedCoreProject(
                "run-1", "task-1", 1, "run-1", "task-1", 1, "WAITING_PROJECT", true
            ));
    }

    @Test
    public void stableProjectContextSamplesMustBelongToSameRun() {
        assertTrue(ChatGptB1Policy.isSameProjectContextCandidate(
            "run-A", "task-A", 1, "run-A", "task-A", 1
        ));
        assertFalse("Old run's samples must never count for new run",
            ChatGptB1Policy.isSameProjectContextCandidate(
                "run-A", "task-A", 1, "run-B", "task-A", 1
            ));
        assertFalse("Old task's samples must never count for new task",
            ChatGptB1Policy.isSameProjectContextCandidate(
                "run-A", "task-A", 1, "run-A", "task-B", 1
            ));
        assertFalse(ChatGptB1Policy.isSameProjectContextCandidate(
            "run-A", "task-A", 1, "run-A", "task-A", 2
        ));
        assertFalse(ChatGptB1Policy.isSameProjectContextCandidate(
            "", "task-A", 1, "run-A", "task-A", 1
        ));
        assertFalse(ChatGptB1Policy.isSameProjectContextCandidate(
            "run-A", "task-A", 0, "run-A", "task-A", 0
        ));
    }

    @Test
    public void coreProjectBindingMutatesOnlyMatchingRunAfterFreshSamples() throws Exception {
        String service = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/AccessibilityBridgeService.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        String store = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1RunStore.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        int start = service.indexOf("private void maybeBindProjectFromStableContext(");
        int end = service.indexOf("private void maybeActivateStandaloneFallback(", start);
        assertTrue(start >= 0 && end > start);
        String binder = service.substring(start, end);
        assertTrue("Reset candidate when run/task/cycle changes",
            binder.contains("isSameProjectContextCandidate(")
                && binder.contains("resetProjectContextCandidate()")
                && binder.contains("projectContextCandidateRunId = run.runId")
                && binder.contains("projectContextCandidateTaskId = run.taskId")
                && binder.contains("projectContextCandidateCycle = run.cycle"));
        assertTrue("Core-only stable Project binding must be identity guarded",
            binder.contains("if (coreTask)")
                && binder.contains("markCoreProjectBoundIfCurrent("));
        assertTrue("Manual B1 Project path remains independent",
            binder.contains("ChatGptB1RunStore.markProjectBound(this)"));
        int begin = store.indexOf(
            "public static synchronized boolean markCoreProjectBoundIfCurrent("
        );
        int finish = store.indexOf(
            "public static synchronized void markStandaloneFallbackReady(", begin
        );
        assertTrue(begin >= 0 && finish > begin);
        String guarded = store.substring(begin, finish);
        assertTrue(guarded.contains("Snapshot live = read(context)"));
        assertTrue(guarded.contains("canBindObservedCoreProject("));
        assertTrue("Persistent write happens only after durable Core validation",
            guarded.indexOf("canBindObservedCoreProject(")
                < guarded.indexOf(".putBoolean(K_PROJECT_BOUND, true)"));
        assertTrue("Core Project binding must be durably committed",
            guarded.contains(".commit()"));
        assertFalse("Core Project binding may not be asynchronous",
            guarded.contains(".apply()"));
        assertTrue("Clear sample identity when discarding evidence",
            service.contains("projectContextCandidateRunId = \"\"")
                && service.contains("projectContextCandidateTaskId = \"\"")
                && service.contains("projectContextCandidateCycle = 0"));
    }

    @Test
    public void observedCoreCallbackRejectsReplacementAndWrongState() {
        assertTrue(ChatGptB1Policy.canMutateObservedCoreRun(
            "run-old", "task-old", 1, "run-old", "task-old", 1,
            "INPUT_READY", "INPUT_READY"
        ));
        assertFalse("A replaced run cannot be failed by an old callback",
            ChatGptB1Policy.canMutateObservedCoreRun(
                "run-old", "task-old", 1, "run-new", "task-old", 1,
                "INPUT_READY", "INPUT_READY"
            ));
        assertFalse("A replaced task cannot be marked INPUT_READY",
            ChatGptB1Policy.canMutateObservedCoreRun(
                "run-old", "task-old", 1, "run-old", "task-new", 1,
                "REQUESTED", "REQUESTED"
            ));
        assertFalse("An earlier cycle cannot fail its successor",
            ChatGptB1Policy.canMutateObservedCoreRun(
                "run-old", "task-old", 1, "run-old", "task-old", 2,
                "WAITING_AI", "WAITING_AI"
            ));
        assertFalse("Terminal Core runs reject stale errors",
            ChatGptB1Policy.canMutateObservedCoreRun(
                "run-old", "task-old", 1, "run-old", "task-old", 1,
                "COMPLETE", "WAITING_AI", "INPUT_READY", "REQUESTED"
            ));
        assertFalse("A sent task cannot be reverted to verifying context",
            ChatGptB1Policy.canMutateObservedCoreRun(
                "run-old", "task-old", 1, "run-old", "task-old", 1,
                "WAITING_AI", "REQUESTED", "VERIFYING_CONTEXT"
            ));
        assertFalse(ChatGptB1Policy.canMutateObservedCoreRun(
            "", "task-old", 1, "run-old", "task-old", 1, "INPUT_READY",
            "INPUT_READY"
        ));
        assertFalse(ChatGptB1Policy.canMutateObservedCoreRun(
            "run-old", null, 1, "run-old", "task-old", 1, "INPUT_READY",
            "INPUT_READY"
        ));
        assertFalse(ChatGptB1Policy.canMutateObservedCoreRun(
            "run-old", "task-old", 0, "run-old", "task-old", 0, "INPUT_READY",
            "INPUT_READY"
        ));
        assertFalse(ChatGptB1Policy.canMutateObservedCoreRun(
            "run-old", "task-old", 1, "run-old", "task-old", 1, "INPUT_READY",
            (String[]) null
        ));
    }

    @Test
    public void allCoreAccessibilityStateWritesRequireObservedLeaseIdentity() throws Exception {
        String src = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        int drive = src.indexOf("public static void drive(");
        int wrappers = src.indexOf("private static void failObservedRun(", drive);
        int end = src.indexOf("public static AccessibilityNodeInfo findExactProjectControl(", wrappers);
        assertTrue(drive >= 0 && wrappers > drive && end > wrappers);
        String body = src.substring(drive, wrappers);
        String guards = src.substring(wrappers, end);
        assertFalse("Never fail the current run via stale Accessibility callback",
            body.contains("ChatGptB1RunStore.fail(service,"));
        assertFalse("Never reset a replacement run's state",
            body.contains("ChatGptB1RunStore.markVerifying(service)")
                || body.contains("ChatGptB1RunStore.markInputReady(service)")
                || body.contains("ChatGptB1RunStore.markBusySeen(service)"));
        assertTrue("Core failure must use a guarded writer",
            body.contains("failObservedRun(service, s,")
                && guards.contains("failCoreIfCurrent("));
        assertTrue("Core input and busy states must use guarded writers",
            body.contains("markVerifyingObservedRun(service, s)")
                && body.contains("markInputReadyObservedRun(service, s)")
                && body.contains("markBusyObservedRun(service, s)")
                && guards.contains("markCoreVerifyingIfCurrent(")
                && guards.contains("markCoreInputReadyIfCurrent(")
                && guards.contains("markCoreBusyIfCurrent("));
        assertTrue("Check durable Core send claim again before click",
            body.contains("isCoreSendClaimStillCurrent(")
                && body.indexOf("isCoreSendClaimStillCurrent(")
                    < body.indexOf("boolean clicked = send.performAction("));
        assertTrue("Manual B1 run keeps its existing independent path",
            guards.contains("ChatGptB1RunStore.fail(service, code);")
                && guards.contains("ChatGptB1RunStore.markVerifying(service);"));
        String store = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1RunStore.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        assertTrue("Core failure must be guarded and durable",
            store.contains("public static synchronized boolean failCoreIfCurrent(")
                && store.contains(".putString(K_STATE, \"ERROR\")")
                && store.contains(".putInt(K_EVIDENCE_SEQ, live.evidenceSeq + 1)")
                && store.contains(".commit();"));
        assertTrue("Core callback transitions must serialize with startTask",
            store.contains("public static synchronized boolean markCoreVerifyingIfCurrent(")
                && store.contains("public static synchronized boolean markCoreInputReadyIfCurrent(")
                && store.contains("public static synchronized boolean markCoreBusyIfCurrent(")
                && store.contains("public static synchronized void cancel(Context context)"));
    }

    @Test
    public void coreSendClaimRejectsAnyReplacedRunTaskCycleOrPrompt() {
        String run = "RUN-A", task = "TASK-A", prompt = "LEASED-PROMPT-A";
        assertTrue(ChatGptB1Policy.canClaimCoreSendForSnapshot(
            run, task, 1, prompt, run, task, 1, "INPUT_READY", 0,
            prompt, true, "PROJECT"
        ));
        assertFalse("Cannot claim another run",
            ChatGptB1Policy.canClaimCoreSendForSnapshot(
                run, task, 1, prompt, "RUN-B", task, 1,
                "INPUT_READY", 0, prompt, true, "PROJECT"
            ));
        assertFalse("Cannot claim another task",
            ChatGptB1Policy.canClaimCoreSendForSnapshot(
                run, task, 1, prompt, run, "TASK-B", 1,
                "INPUT_READY", 0, prompt, true, "PROJECT"
            ));
        assertFalse("Cannot claim another cycle",
            ChatGptB1Policy.canClaimCoreSendForSnapshot(
                run, task, 1, prompt, run, task, 2,
                "INPUT_READY", 0, prompt, true, "PROJECT"
            ));
        assertFalse("A changed task prompt is not the original lease",
            ChatGptB1Policy.canClaimCoreSendForSnapshot(
                run, task, 1, prompt, run, task, 1,
                "INPUT_READY", 0, "OTHER-PROMPT", true, "PROJECT"
            ));
        assertFalse("Existing send claim prevents double sending",
            ChatGptB1Policy.canClaimCoreSendForSnapshot(
                run, task, 1, prompt, run, task, 1,
                "INPUT_READY", 1, prompt, true, "PROJECT"
            ));
        assertFalse("A standby run cannot claim Core Send",
            ChatGptB1Policy.canClaimCoreSendForSnapshot(
                run, task, 1, prompt, run, task, 1,
                "WAITING_AI", 0, prompt, true, "PROJECT"
            ));
        assertFalse("Standalone fallback can never claim Core Send",
            ChatGptB1Policy.canClaimCoreSendForSnapshot(
                run, task, 1, prompt, run, task, 1,
                "INPUT_READY", 0, prompt, true, "STANDALONE_FALLBACK"
            ));
        assertFalse("Unbound project can never claim Core Send",
            ChatGptB1Policy.canClaimCoreSendForSnapshot(
                run, task, 1, prompt, run, task, 1,
                "INPUT_READY", 0, prompt, false, "PROJECT"
            ));
    }

    @Test
    public void coreReplyCannotCompleteReplacedOrMisattributedLease() {
        String token = "TIGERIQ_CORE_OK_771", reply = "Completed " + token;
        assertTrue(ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
            "RUN-A", "TASK-A", 1, token, reply,
            "RUN-A", "TASK-A", 1, "WAITING_AI", 1,
            1, 0, token, true, "PROJECT"
        ));
        assertFalse("Old chat cannot complete new run",
            ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
                "RUN-A", "TASK-A", 1, token, reply,
                "RUN-B", "TASK-A", 1, "WAITING_AI", 1,
                1, 0, token, true, "PROJECT"
            ));
        assertFalse("Old chat cannot complete new task",
            ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
                "RUN-A", "TASK-A", 1, token, reply,
                "RUN-A", "TASK-B", 1, "WAITING_AI", 1,
                1, 0, token, true, "PROJECT"
            ));
        assertFalse("Old chat cannot complete a new cycle",
            ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
                "RUN-A", "TASK-A", 1, token, reply,
                "RUN-A", "TASK-A", 2, "WAITING_AI", 2,
                1, 0, token, true, "PROJECT"
            ));
        assertFalse("A changed expected token is a different lease",
            ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
                "RUN-A", "TASK-A", 1, token, reply,
                "RUN-A", "TASK-A", 1, "WAITING_AI", 1,
                1, 0, "OTHER_TOKEN", true, "PROJECT"
            ));
        assertFalse("Receipt must be attributed to the current send cycle",
            ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
                "RUN-A", "TASK-A", 1, token, reply,
                "RUN-A", "TASK-A", 1, "WAITING_AI", 0,
                1, 0, token, true, "PROJECT"
            ));
        assertFalse("Duplicate send attempts invalidate completion",
            ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
                "RUN-A", "TASK-A", 1, token, reply,
                "RUN-A", "TASK-A", 1, "WAITING_AI", 1,
                1, 1, token, true, "PROJECT"
            ));
        assertFalse("Incomplete or unverified response is not completion",
            ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
                "RUN-A", "TASK-A", 1, token, "wrong token",
                "RUN-A", "TASK-A", 1, "WAITING_AI", 1,
                1, 0, token, true, "PROJECT"
            ));
        assertFalse("A terminal run must never be completed twice",
            ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
                "RUN-A", "TASK-A", 1, token, reply,
                "RUN-A", "TASK-A", 1, "COMPLETE", 1,
                1, 0, token, true, "PROJECT"
            ));
    }

    @Test
    public void coreSendAndReplyMutationsCompareDurableIdentityWithinLock() throws Exception {
        String store = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1RunStore.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        String adapter = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        int claim = store.indexOf("public static synchronized boolean markSentExactlyOnce(\n");
        int manualClaim = store.indexOf("public static synchronized boolean markSentExactlyOnce(Context context)");
        assertTrue(claim >= 0 && manualClaim > claim);
        String coreClaim = store.substring(claim, manualClaim);
        assertTrue(coreClaim.contains("Snapshot live = read(context)"));
        assertTrue(coreClaim.contains("canClaimCoreSendForSnapshot("));
        assertTrue(coreClaim.indexOf("canClaimCoreSendForSnapshot(")
            < coreClaim.indexOf("persistSendClaim(context, live)"));
        int complete = store.indexOf("public static synchronized boolean completeCoreReplyIfCurrent(");
        int legacyComplete = store.indexOf("public static void completeCurrentCycle(Context context, String responseText)");
        assertTrue(complete >= 0 && legacyComplete > complete);
        String coreCompletion = store.substring(complete, legacyComplete);
        assertTrue(coreCompletion.contains("canCompleteCoreReplyForSnapshot("));
        assertTrue(coreCompletion.indexOf("canCompleteCoreReplyForSnapshot(")
            < coreCompletion.indexOf("finishCycleFromSnapshot(context, live, responseText)"));
        assertTrue("Both mutations must preserve original run identity",
            adapter.contains("service, s.runId, s.taskId, s.cycle, prompt")
                && adapter.contains("service, s.runId, s.taskId, s.cycle,"));
        assertTrue("Stale Core claim must never fail or cancel the new run",
            adapter.contains("if (!coreLeaseAtSend) {")
                && adapter.contains("SEND_CLAIM_PERSIST_FAILED"));
    }

    @Test
    public void coreSendRequiresExactLiveComposerTextAfterFillCooldown() {
        String prompt = "Work lease 2949 confirmed TASK_77";
        assertTrue(ChatGptB1Policy.canSendCorePromptFromLiveComposer(
            "INPUT_READY", prompt, prompt, true, true
        ));
        assertFalse("Empty input after fill must never claim/send Core work",
            ChatGptB1Policy.canSendCorePromptFromLiveComposer(
                "INPUT_READY", prompt, "", true, true
            ));
        assertFalse("Human replacement must never be sent as Core work",
            ChatGptB1Policy.canSendCorePromptFromLiveComposer(
                "INPUT_READY", prompt, "human text", true, true
            ));
        assertFalse("Prefix/subset of Core task is not the full prompt",
            ChatGptB1Policy.canSendCorePromptFromLiveComposer(
                "INPUT_READY", prompt, "Work lease 2949", true, true
            ));
        assertFalse("Whitespace mutation is a different prompt",
            ChatGptB1Policy.canSendCorePromptFromLiveComposer(
                "INPUT_READY", prompt, prompt + " ", true, true
            ));
        assertFalse(ChatGptB1Policy.canSendCorePromptFromLiveComposer(
            "INPUT_READY", null, null, true, true
        ));
        assertFalse(ChatGptB1Policy.canSendCorePromptFromLiveComposer(
            "INPUT_READY", prompt, null, true, true
        ));
        assertFalse(ChatGptB1Policy.canSendCorePromptFromLiveComposer(
            "WAITING_AI", prompt, prompt, true, true
        ));
        assertFalse(ChatGptB1Policy.canSendCorePromptFromLiveComposer(
            "INPUT_READY", prompt, prompt, false, true
        ));
        assertFalse(ChatGptB1Policy.canSendCorePromptFromLiveComposer(
            "INPUT_READY", prompt, prompt, true, false
        ));
    }

    @Test
    public void coreSendLiveComposerGuardPrecedesSendButtonSelectionAndClaim() throws Exception {
        String src = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        int inputReady = src.indexOf("if (!\"INPUT_READY\".equals(s.state)) return;");
        int exactGuard = src.indexOf("canSendCorePromptFromLiveComposer(", inputReady);
        int findSend = src.indexOf("findTrustedCoreSendControl(root, input)", exactGuard);
        int sendClaim = src.indexOf("markSentExactlyOnce(service)", findSend);
        int sendClick = src.indexOf("ACTION_CLICK", sendClaim);
        assertTrue("Core live composer verification must precede irreversible send",
            inputReady >= 0 && exactGuard > inputReady && findSend > exactGuard
                && sendClaim > findSend && sendClick > sendClaim);
        assertTrue(src.substring(exactGuard, findSend)
            .contains("CORE_COMPOSER_TEXT_LOST_BEFORE_SEND"));
        assertTrue("Manual B1 must retain its independent send route",
            src.contains(": findSendControl(root, input)"));
    }

    @Test
    public void coreSendControlRequiresOwnTrustedButtonIdentity() {
        assertTrue(ChatGptB1Policy.isTrustedCoreSendControl(
            true, true, true, "android.widget.ImageButton",
            "com.openai.chatgpt:id/composer_send_button", ""
        ));
        assertTrue(ChatGptB1Policy.isTrustedCoreSendControl(
            true, true, true, "android.widget.Button", "", "Send message"
        ));
        assertTrue(ChatGptB1Policy.isTrustedCoreSendControl(
            true, true, true, "android.widget.ImageButton", "", "Gửi"
        ));
        assertFalse("A clickable chat bubble quoting Send must not become a Core action",
            ChatGptB1Policy.isTrustedCoreSendControl(
                true, true, true, "android.view.View",
                "message_bubble", "Send"
            ));
        assertFalse("Generic icon buttons must never be guessed as Send",
            ChatGptB1Policy.isTrustedCoreSendControl(
                true, true, true, "android.widget.ImageButton",
                "arrow_up", ""
            ));
        assertFalse("A send-later button is not the current Send action",
            ChatGptB1Policy.isTrustedCoreSendControl(
                true, true, true, "android.widget.Button", "", "Send later"
            ));
        assertFalse("Navigation Send labels are not automatically Core Send",
            ChatGptB1Policy.isTrustedCoreSendControl(
                true, true, true, "android.widget.Button",
                "settings_send_logs", ""
            ));
        assertFalse("Hidden controls cannot trigger Core sending",
            ChatGptB1Policy.isTrustedCoreSendControl(
                false, true, true, "android.widget.Button", "send_button", ""
            ));
        assertFalse("Disabled controls cannot trigger Core sending",
            ChatGptB1Policy.isTrustedCoreSendControl(
                true, false, true, "android.widget.Button", "send_button", ""
            ));
        assertFalse("Nonclickable labels cannot trigger Core sending",
            ChatGptB1Policy.isTrustedCoreSendControl(
                true, true, false, "android.widget.Button", "send_button", ""
            ));
    }

    @Test
    public void coreSendSelectorCannotScanWholeTranscriptOrGuessAnonymousIcons()
        throws Exception {
        String source = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        String coreDispatch = "(s.taskId != null && !s.taskId.isEmpty())"
            + "\n            ? findTrustedCoreSendControl(root, input)"
            + "\n            : findSendControl(root, input)";
        assertTrue("Leased Core must use stronger Send selector than manual B1",
            source.contains(coreDispatch));
        int begin = source.indexOf(
            "public static AccessibilityNodeInfo findTrustedCoreSendControl("
        );
        int end = source.indexOf(
            "public static AccessibilityNodeInfo findSendControl(", begin
        );
        assertTrue(begin >= 0 && end > begin);
        String selector = source.substring(begin, end);
        assertTrue("Core Send must be scoped to the actual live composer",
            selector.contains("composerInput.getParent()")
                && selector.contains("belongsToRoot"));
        assertTrue("Native own-button role must be checked",
            selector.contains("isTrustedCoreSendControl("));
        assertTrue("Refuse broad transcript/scroll-containing selection",
            selector.contains("node.isScrollable()")
                && selector.contains("message_list")
                && selector.contains("inspected > 48"));
        assertTrue("Refuse multiple competing Send controls",
            selector.contains("found != null && !found.equals(node)"));
        assertFalse("No global visible-message scan for Core send",
            selector.contains("nodes(root)"));
        assertFalse("No anonymous icon guessing for Core send",
            selector.contains("uniqueComposerAction("));
        assertFalse("No coordinate/gesture fallback",
            selector.contains("getBoundsInScreen"));
    }

    @Test
    public void coreReceiptTokenMustMatchExactIdentifierAndCase() {
        String expected = "TIGERIQ_B1_OK_4402";
        assertTrue(ChatGptB1Policy.containsExactCoreToken("Confirmed: " + expected, expected));
        assertTrue(ChatGptB1Policy.containsExactCoreToken("(" + expected + ").", expected));
        assertFalse(ChatGptB1Policy.containsExactCoreToken(expected + "_OTHER", expected));
        assertFalse(ChatGptB1Policy.containsExactCoreToken(expected + "9", expected));
        assertFalse(ChatGptB1Policy.containsExactCoreToken("X" + expected, expected));
        assertFalse(ChatGptB1Policy.containsExactCoreToken("prefix_" + expected, expected));
        assertFalse(ChatGptB1Policy.containsExactCoreToken(expected.toLowerCase(java.util.Locale.ROOT), expected));
        assertFalse(ChatGptB1Policy.containsExactCoreToken(null, expected));
        assertFalse(ChatGptB1Policy.containsExactCoreToken("anything", ""));

        ChatGptB1Policy.CoreReplyMatcher prefixSpoof =
            new ChatGptB1Policy.CoreReplyMatcher("Current task", expected, true);
        prefixSpoof.observe("USER", "Current task");
        prefixSpoof.observe("ASSISTANT", "Completed: " + expected + "_OTHER");
        assertEquals("A longer token is not the Core receipt", "", prefixSpoof.verifiedReply());

        ChatGptB1Policy.CoreReplyMatcher validAfterSpoof =
            new ChatGptB1Policy.CoreReplyMatcher("Current task", expected, true);
        validAfterSpoof.observe("USER", "Current task");
        validAfterSpoof.observe("ASSISTANT", "Another id " + expected + "_OTHER");
        validAfterSpoof.observe("ASSISTANT", "Completed: " + expected);
        assertEquals("Completed: " + expected, validAfterSpoof.verifiedReply());
    }

    @Test
    public void coreReplyMatcherPreSendFindsReplayWithoutRequiringTokenInUserText() {
        ChatGptB1Policy.CoreReplyMatcher promptAlreadySent =
            new ChatGptB1Policy.CoreReplyMatcher("Core payload", "REQ-9", false);
        promptAlreadySent.observe("USER", "Core payload");
        assertTrue(promptAlreadySent.hasPreexistingTaskTranscript());

        ChatGptB1Policy.CoreReplyMatcher oldAssistant =
            new ChatGptB1Policy.CoreReplyMatcher("Core payload", "REQ-9", false);
        oldAssistant.observe("ASSISTANT", "result REQ-9");
        assertTrue(oldAssistant.hasPreexistingTaskTranscript());

        ChatGptB1Policy.CoreReplyMatcher userEcho =
            new ChatGptB1Policy.CoreReplyMatcher("Core payload", "REQ-9", false);
        userEcho.observe("USER", "REQ-9 from quoted log");
        userEcho.observe("UNKNOWN", "REQ-9 in composer");
        assertFalse("Quoted token is not proof of a completed Core task",
            userEcho.hasPreexistingTaskTranscript());
        assertEquals("", userEcho.verifiedReply());
    }

    @Test
    public void coreReplyNeverSucceedsAfterDeadlineOrDuringGeneration() {
        long sent = 1_000_000L;
        long timeout = 90_000L;
        assertTrue(ChatGptB1Policy.canAcceptCoreReplyWithinWindow(
            sent, sent, timeout, false
        ));
        assertTrue(ChatGptB1Policy.canAcceptCoreReplyWithinWindow(
            sent, sent + timeout, timeout, false
        ));
        assertFalse("Token on first millisecond AFTER deadline is never accepted",
            ChatGptB1Policy.canAcceptCoreReplyWithinWindow(
                sent, sent + timeout + 1L, timeout, false
            ));
        assertFalse("Visible generation control means the model is still streaming",
            ChatGptB1Policy.canAcceptCoreReplyWithinWindow(
                sent, sent + 1000L, timeout, true
            ));
        assertFalse("Missing durable send timestamp cannot be credited",
            ChatGptB1Policy.canAcceptCoreReplyWithinWindow(0L, sent, timeout, false));
        assertFalse("Clock rollback cannot credit an unverified transcript",
            ChatGptB1Policy.canAcceptCoreReplyWithinWindow(sent, sent - 1L, timeout, false));
        assertFalse("Zero timeout is invalid",
            ChatGptB1Policy.canAcceptCoreReplyWithinWindow(sent, sent, 0L, false));
    }

    @Test
    public void coreReplyDeadlineAndBusyGateRunBeforeAnyTokenScan() throws Exception {
        String src = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        int begin = src.indexOf("if (\"WAITING_AI\".equals(s.state))");
        int end = src.indexOf("if (s.cycleStartedAt > 0", begin);
        assertTrue(begin >= 0 && end > begin);
        String waiting = src.substring(begin, end);
        int deadline = waiting.indexOf("canAcceptCoreReplyWithinWindow(");
        int scan = waiting.indexOf("coreResponseTextContaining(");
        assertTrue("Core deadline gate must PRECEDE token response scan",
            deadline >= 0 && scan > deadline);
        assertTrue("Busy state must feed the Core receipt gate",
            waiting.contains("generationInProgress")
                && waiting.contains("RESPONSE_TIMEOUT")
                && waiting.contains("CORE_REPLY_CLOCK_OR_SEND_INVALID")
                && waiting.contains("markBusyObservedRun(service, s)"));
        assertTrue("Manual B1 matcher must remain separately reachable",
            waiting.contains(": responseTextContaining(root"));
    }

    @Test
    public void coreResponseContractUsesOrderedStructuralRoleEvidence() throws Exception {
        String src = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        int waiting = src.indexOf("if (\"WAITING_AI\".equals(s.state))");
        int timeout = src.indexOf("if (s.cycleStartedAt > 0", waiting);
        assertTrue(waiting >= 0 && timeout > waiting);
        String receipt = src.substring(waiting, timeout);
        assertTrue("Core must use different scan from manual B1",
            receipt.contains("coreLease") && receipt.contains("coreResponseTextContaining("));
        assertTrue("Manual B1 behavior stays separate",
            receipt.contains(": responseTextContaining(root"));
        assertTrue("Send timestamp/cycle must be checked before a Core receipt",
            receipt.contains("s.sentAt > 0 && s.sentCycle == s.cycle"));

        int begin = src.indexOf("static String coreResponseTextContaining(");
        int end = src.indexOf("static String responseTextContaining(", begin);
        assertTrue(begin >= 0 && end > begin);
        String trustedScan = src.substring(begin, end);
        assertTrue("Transcript order must be preserved",
            trustedScan.contains("preorderNodes(root)"));
        assertTrue("Role must derive from app-owned structural metadata",
            trustedScan.contains("structuralMessageRole("));
        assertTrue("One tested matcher must own response chronology",
            trustedScan.contains("CoreReplyMatcher matcher"));
        assertTrue("Receipt requires verified matcher output",
            trustedScan.contains("matcher.verifiedReply()"));
        assertTrue("Pre-send duplicate detection must share the same semantics",
            trustedScan.contains("matcher.hasPreexistingTaskTranscript()"));
        assertTrue("Structural roles must be fed to matcher",
            trustedScan.contains("matcher.observe(role, raw)"));
        assertTrue("Prior matching transcript must be rejected before send",
            src.contains("coreTranscriptAlreadyContainsTask(")
                && src.contains("CORE_RESPONSE_PROVENANCE_PREEXISTS"));
        assertFalse("No screen coordinate fallback",
            trustedScan.contains("getBoundsInScreen"));
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
    public void projectNavigationCannotClickAnExactNameChatMessage()
        throws Exception {
        // The UI may show the exact Project name as a quoted message. An
        // enabled clickable ancestor is NOT sufficient to select a Project.
        assertFalse(ChatGptB1Policy.isTrustedProjectNavigationTarget(
            true, true, false, false, true
        ));
        assertFalse(ChatGptB1Policy.isTrustedProjectNavigationTarget(
            true, true, true, true, true
        ));
        assertFalse(ChatGptB1Policy.isTrustedProjectNavigationTarget(
            true, true, true, false, false
        ));
        assertFalse(ChatGptB1Policy.isTrustedProjectNavigationTarget(
            true, false, true, false, true
        ));
        assertFalse(ChatGptB1Policy.isTrustedProjectNavigationTarget(
            false, true, true, false, true
        ));
        assertTrue(ChatGptB1Policy.isTrustedProjectNavigationTarget(
            true, true, true, false, true
        ));

        String source = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        int begin = source.indexOf("public static AccessibilityNodeInfo findExactProjectControl(");
        int end = source.indexOf("public static AccessibilityNodeInfo findNewChatControl(", begin);
        assertTrue(begin >= 0 && end > begin);
        String select = source.substring(begin, end);
        assertTrue("Navigation selection must gate exact-name clickable",
            select.contains("isTrustedProjectNavigationTarget("));
        assertTrue("Reject any clickable message with a matching quote",
            select.contains("conversationScope"));
        assertTrue("Require navigation drawer or semantic project list scope",
            select.contains("navigationScope"));
        assertTrue("Reject unverified/incomplete hierarchy",
            select.contains("completeAncestry"));
        assertFalse("Never click arbitrary matching text via nearestClickable alone",
            select.contains("if (clickable != null && clickable.isEnabled()) return clickable;"));
    }

    @Test
    public void navigationProofIsMandatoryOnlyForCoreProjectBinding() {
        // Ordinary chat renamed to TigerIQ AI Lab with a composer and title:
        // without a same-run Project navigation event it MUST NOT bind Core.
        assertFalse(ChatGptB1Policy.canBindStableProjectContextForTask(
            "MT-2949", true, true, true, false, 3, 1200L
        ));
        // Same-run navigation is necessary, but must not skip stable evidence.
        assertTrue(ChatGptB1Policy.canBindStableProjectContextForTask(
            "MT-2949", true, true, true, true, 3, 1200L
        ));
        assertFalse(ChatGptB1Policy.canBindStableProjectContextForTask(
            "MT-2949", true, false, true, true, 3, 1200L
        ));
        assertFalse(ChatGptB1Policy.canBindStableProjectContextForTask(
            "MT-2949", true, true, false, true, 3, 1200L
        ));
        assertFalse(ChatGptB1Policy.canBindStableProjectContextForTask(
            "MT-2949", true, true, true, true, 2, 1200L
        ));
        assertFalse(ChatGptB1Policy.canBindStableProjectContextForTask(
            "MT-2949", true, true, true, true, 3, 1199L
        ));
        // Existing manual/standalone B1 remains unchanged.
        assertTrue(ChatGptB1Policy.canBindStableProjectContextForTask(
            "", true, true, true, false, 3, 1200L
        ));
        assertTrue(ChatGptB1Policy.canBindStableProjectContextForTask(
            null, true, true, true, false, 3, 1200L
        ));
    }

    @Test
    public void projectHeaderCannotBindCoreTaskWithoutFreshNavigationProof()
        throws Exception {
        // A normal chat can be named exactly TigerIQ AI Lab. A title+composer
        // alone do not prove a genuine Core task's intended Project navigation.
        String source = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/AccessibilityBridgeService.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        int start = source.indexOf("private void maybeBindProjectFromStableContext(");
        int end = source.indexOf("private void maybeActivateStandaloneFallback(", start);
        assertTrue(start >= 0 && end > start);
        String bind = source.substring(start, end);
        assertTrue("Core must use the task-aware binding gate",
            bind.contains("canBindStableProjectContextForTask("));
        assertTrue("Core task identity must be passed to the binding gate",
            bind.contains("run.taskId"));
        assertTrue("Fresh automatic Project navigation evidence must be checked",
            bind.contains("autoNavigationProof"));
        assertFalse("Title-only context may not silently satisfy Core binding",
            bind.contains("boolean contextProof = projectTitleContext;"));
    }

    @Test
    public void rejectsChatMessageSpoofingTheProjectHeader() {
        assertTrue(ChatGptB1Policy.isVerifiedProjectHeaderEvidence(
            true, true, false, false, true
        ));
        // A visible chat message or markdown heading with identical Project text.
        assertFalse(ChatGptB1Policy.isVerifiedProjectHeaderEvidence(
            true, false, false, false, true
        ));
        // Chat content can be nested in a scroll container even if isScrollable is false.
        assertFalse(ChatGptB1Policy.isVerifiedProjectHeaderEvidence(
            true, true, true, false, true
        ));
        // A sidebar navigation element more than three parents deep.
        assertFalse(ChatGptB1Policy.isVerifiedProjectHeaderEvidence(
            true, true, false, true, true
        ));
        // A truncated ancestry is not trustworthy Project evidence.
        assertFalse(ChatGptB1Policy.isVerifiedProjectHeaderEvidence(
            true, true, false, false, false
        ));
        assertFalse(ChatGptB1Policy.isVerifiedProjectHeaderEvidence(
            false, true, false, false, true
        ));
    }

    @Test
    public void liveProjectTitleGuardMustInspectFullAncestryAndSemanticToolbar()
        throws Exception {
        String source = new String(
            java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(
                "src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java"
            )), java.nio.charset.StandardCharsets.UTF_8
        );
        int start = source.indexOf(
            "public static boolean treeContainsExactLabelOutsideClickableNavigation("
        );
        int end = source.indexOf("public static boolean nodeOrAncestorContainsLabel(", start);
        assertTrue(start >= 0 && end > start);
        String guard = source.substring(start, end);
        assertTrue("Do not trust any arbitrary matching chat bubble",
            guard.contains("isVerifiedProjectHeaderEvidence("));
        assertTrue("Scan full ancestry rather than three parent levels",
            guard.contains("getParent()"));
        assertTrue("Exclude scrolling message content",
            guard.contains("isScrollable()"));
        assertTrue("Exclude scrolling containers regardless of current scrollability",
            guard.contains("recyclerview") && guard.contains("scrollview"));
        assertTrue("Require explicitly named toolbar hierarchy",
            guard.contains("toolbar") && guard.contains("semanticToolbar"));
        assertFalse("No coordinates in semantic-only accessibility adapter",
            guard.contains("getBoundsInScreen"));
        assertFalse("Never truncate clickable ancestor check at maxParents=3",
            guard.contains("depth <= maxParents"));
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
