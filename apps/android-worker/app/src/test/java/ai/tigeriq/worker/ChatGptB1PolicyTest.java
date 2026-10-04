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
    public void boundsWaitingProjectWithoutAffectingOtherStates() {
        long startedAt = 1_000_000L;
        assertFalse(ChatGptB1Policy.waitingProjectTimedOut(
            "WAITING_PROJECT", startedAt, startedAt + ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS - 1L
        ));
        assertTrue(ChatGptB1Policy.waitingProjectTimedOut(
            "WAITING_PROJECT", startedAt, startedAt + ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS
        ));
        assertFalse(ChatGptB1Policy.waitingProjectTimedOut(
            "REQUESTED", startedAt, startedAt + ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS
        ));
        assertFalse(ChatGptB1Policy.waitingProjectTimedOut(
            "WAITING_PROJECT", 0L, startedAt + ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS
        ));
        assertFalse(ChatGptB1Policy.waitingProjectTimedOut(
            "WAITING_PROJECT", startedAt + 10_000L, startedAt
        ));
        assertEquals(60_000L, ChatGptB1Policy.PROJECT_BIND_TIMEOUT_MS);
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
