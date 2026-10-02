package ai.tigeriq.worker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public final class ControllerUrlPolicyTest {
    @Test
    public void acceptsHttpsAndStripsTrailingSlash() {
        assertEquals("https://controller.example.test", ControllerUrlPolicy.requireTrusted("https://controller.example.test/"));
    }

    @Test
    public void acceptsTailscaleHttp() {
        assertEquals("http://100.97.23.87:8790", ControllerUrlPolicy.requireTrusted("http://100.97.23.87:8790"));
    }

    @Test
    public void rejectsPublicHttp() {
        assertThrows(IllegalArgumentException.class, () -> ControllerUrlPolicy.requireTrusted("http://example.com"));
    }

    @Test
    public void rejectsUserInfo() {
        assertThrows(IllegalArgumentException.class, () -> ControllerUrlPolicy.requireTrusted("https://user:pass@example.com"));
    }
}
