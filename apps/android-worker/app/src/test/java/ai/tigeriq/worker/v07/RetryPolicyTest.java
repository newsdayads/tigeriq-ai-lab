package ai.tigeriq.worker.v07;
import org.junit.Test;
import static org.junit.Assert.*;
public class RetryPolicyTest {
    @Test public void retriesAreBounded() { assertTrue(RetryPolicy.canRetry(0, true)); assertTrue(RetryPolicy.canRetry(3, true)); assertFalse(RetryPolicy.canRetry(4, true)); assertFalse(RetryPolicy.canRetry(0, false)); }
    @Test public void backoffHonorsServerWithoutGoingUnbounded() { assertEquals(15_000L, RetryPolicy.backoffMs(0, null)); assertEquals(60_000L, RetryPolicy.backoffMs(1, 60_000L)); assertEquals(RetryPolicy.MAX_BACKOFF_MS, RetryPolicy.backoffMs(4, 999_999L)); }
}
