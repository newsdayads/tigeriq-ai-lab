package ai.tigeriq.worker.v07;
import org.junit.Test;
import static org.junit.Assert.*;
public class GatewayUrlPolicyTest {
    @Test public void acceptsHttpsOnly() { assertEquals("https://control.tigeriq.ai", GatewayUrlPolicy.requireHttps("https://control.tigeriq.ai/")); }
    @Test(expected = IllegalArgumentException.class) public void rejectsCleartext() { GatewayUrlPolicy.requireHttps("http://100.64.0.1"); }
}
