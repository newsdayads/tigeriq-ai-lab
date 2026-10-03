package ai.tigeriq.worker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ChatGptB1PolicyTest {
    @Test
    public void bindsClickPathOnlyFromRealChatGptClickOnExactRequiredProject() {
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
    public void bindsStableContextOnlyFromTitleSignalComposerAndFreshThresholds() {
        assertTrue(ChatGptB1Policy.shouldBindRequiredProjectFromStableContext(
            true, false, "WAITING_PROJECT", true,
            true, true, true, 3, 1200L
        ));

        // Exact conversation text alone must never be treated as an active Project title.
        assertFalse(ChatGptB1Policy.shouldBindRequiredProjectFromStableContext(
            true, false, "WAITING_PROJECT", true,
            true, false, true, 3, 1200L
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProjectFromStableContext(
            true, false, "WAITING_PROJECT", true,
            true, true, false, 3, 1200L
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProjectFromStableContext(
            true, false, "WAITING_PROJECT", true,
            true, true, true, 2, 5000L
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProjectFromStableContext(
            true, false, "WAITING_PROJECT", true,
            true, true, true, 3, 1199L
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProjectFromStableContext(
            true, false, "REQUESTED", true,
            true, true, true, 3, 1200L
        ));
        assertFalse(ChatGptB1Policy.shouldBindRequiredProjectFromStableContext(
            true, true, "WAITING_PROJECT", true,
            true, true, true, 3, 1200L
        ));
    }

    @Test
    public void enforcesFillAndInterCyclePacing() {
        long now = 1_000_000L;
        assertEquals(now + 3000L, ChatGptB1Policy.nextActionAfterFill(now));
        assertEquals(now + 6000L, ChatGptB1Policy.nextActionAfterCycle(now));
        assertEquals(3000L, ChatGptB1Policy.MIN_FILL_TO_SEND_MS);
        assertEquals(6000L, ChatGptB1Policy.INTER_CYCLE_COOLDOWN_MS);
        assertEquals(3, ChatGptB1Policy.PROJECT_STABLE_MIN_SAMPLES);
        assertEquals(1200L, ChatGptB1Policy.PROJECT_STABLE_MIN_MS);
    }
}
