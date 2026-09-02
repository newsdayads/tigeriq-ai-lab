package ai.tigeriq.worker.v07;

import org.junit.Test;

import static org.junit.Assert.*;

public class GatewayUrlPolicyTest {
    @Test public void acceptsHttpsController() {
        assertEquals("https://control.tigeriq.ai", GatewayUrlPolicy.requireControllerUrl("https://control.tigeriq.ai/"));
    }

    @Test public void acceptsTailscaleHttpController() {
        assertEquals("http://100.97.23.87:8790", GatewayUrlPolicy.requireControllerUrl("http://100.97.23.87:8790/"));
    }

    @Test(expected = IllegalArgumentException.class) public void rejectsPublicCleartext() {
        GatewayUrlPolicy.requireControllerUrl("http://8.8.8.8:8790");
    }

    @Test(expected = IllegalArgumentException.class) public void rejectsNonTailscale100Range() {
        GatewayUrlPolicy.requireControllerUrl("http://100.128.0.1:8790");
    }

    @Test public void recognizesTailscaleCgnatBoundary() {
        assertTrue(GatewayUrlPolicy.isTailscaleIpv4("100.64.0.1"));
        assertTrue(GatewayUrlPolicy.isTailscaleIpv4("100.127.255.254"));
        assertFalse(GatewayUrlPolicy.isTailscaleIpv4("100.63.255.255"));
        assertFalse(GatewayUrlPolicy.isTailscaleIpv4("100.128.0.1"));
    }
}
