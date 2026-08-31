package ai.tigeriq.worker.v07;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class SessionLifecycleTest {
    @Test public void usableOnlyBeforeExpirySkew() {
        long now = 1_000_000L;
        assertTrue(SessionLifecycle.usable(now + 120_000L, now, 60_000L));
        assertFalse(SessionLifecycle.usable(now + 60_000L, now, 60_000L));
        assertFalse(SessionLifecycle.usable(now - 1L, now, 60_000L));
        assertFalse(SessionLifecycle.usable(0L, now, 60_000L));
    }

    @Test(expected = IllegalArgumentException.class)
    public void negativeSkewFailsClosed() {
        SessionLifecycle.usable(10L, 0L, -1L);
    }
}
