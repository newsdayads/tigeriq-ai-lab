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
    public void enforcesFillAndInterCyclePacing() {
        long now = 1_000_000L;
        assertEquals(now + 5000L, ChatGptB1Policy.nextActionAfterFill(now));
        assertEquals(now + 8000L, ChatGptB1Policy.nextActionAfterCycle(now));
        assertEquals(5000L, ChatGptB1Policy.MIN_FILL_TO_SEND_MS);
        assertEquals(8000L, ChatGptB1Policy.INTER_CYCLE_COOLDOWN_MS);
    }
}
