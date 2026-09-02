package ai.tigeriq.worker.v07;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class GatewayUrlPolicyTest {
    @Test public void acceptsCanonicalTailscaleHttpController() {
        assertEquals("http://100.97.23.87:8790", GatewayUrlPolicy.requireControllerUrl("http://100.97.23.87:8790/"));
    }

    @Test public void acceptsCanonicalHttpsController() {
        assertEquals("https://100.97.23.87:8790", GatewayUrlPolicy.requireControllerUrl("https://100.97.23.87:8790/"));
    }

    @Test(expected = IllegalArgumentException.class) public void rejectsOtherTailscaleController() {
        GatewayUrlPolicy.requireControllerUrl("http://100.100.20.30:8790");
    }

    @Test(expected = IllegalArgumentException.class) public void rejectsWrongControllerPort() {
        GatewayUrlPolicy.requireControllerUrl("http://100.97.23.87:8791");
    }

    @Test(expected = IllegalArgumentException.class) public void rejectsPublicCleartext() {
        GatewayUrlPolicy.requireControllerUrl("http://8.8.8.8:8790");
    }

    @Test(expected = IllegalArgumentException.class) public void rejectsPublicHttpsEndpoint() {
        GatewayUrlPolicy.requireControllerUrl("https://control.tigeriq.ai:8790");
    }
}
