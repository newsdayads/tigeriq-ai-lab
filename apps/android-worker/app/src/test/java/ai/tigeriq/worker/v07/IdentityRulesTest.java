package ai.tigeriq.worker.v07;
import org.junit.Test;
import static org.junit.Assert.*;
public class IdentityRulesTest {
    @Test public void normalizesAndValidatesContractIds() { assertEquals("EMP-001", IdentityRules.requireId("employeeId", " emp-001 ")); assertTrue(IdentityRules.newDeviceId().startsWith("DEV-")); assertTrue(IdentityRules.nodeIdFor("DEV-ABCDEFGHIJKLMNOPQRST").startsWith("NODE-")); }
    @Test(expected = IllegalArgumentException.class) public void rejectsInvalidContractIds() { IdentityRules.requireId("employeeId", "bad id with spaces"); }
}
