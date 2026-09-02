package ai.tigeriq.worker.v07;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.Assert.assertEquals;

public class ActivationCodeTest {
    @Test public void parsesCanonicalControllerV1BundleWithoutSessionSecret() throws Exception {
        JSONObject object = new JSONObject()
                .put("controller", "http://100.97.23.87:8790")
                .put("employeeId", "emp-001");
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(object.toString().getBytes(StandardCharsets.UTF_8));
        ActivationCode.Bundle bundle = ActivationCode.parse("TIQ1." + encoded);
        assertEquals("http://100.97.23.87:8790", bundle.controller);
        assertEquals("EMP-001", bundle.employeeId);
    }

    @Test public void ignoresLegacyCredentialAndBootstrapFieldsDuringMigration() throws Exception {
        String raw = new JSONObject()
                .put("gateway", "http://100.97.23.87:8790/")
                .put("employeeId", "EMP-002")
                .put("credentialId", "OLD-CRED")
                .put("bootstrapToken", "OLD-UNUSED-SECRET")
                .toString();
        ActivationCode.Bundle bundle = ActivationCode.parse(raw);
        assertEquals("http://100.97.23.87:8790", bundle.controller);
        assertEquals(bundle.controller, bundle.gateway);
        assertEquals("EMP-002", bundle.employeeId);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsOtherControllerEndpoint() throws Exception {
        ActivationCode.parse(new JSONObject()
                .put("controller", "http://100.100.20.30:8790")
                .put("employeeId", "EMP-003")
                .toString());
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsMissingEmployee() throws Exception {
        ActivationCode.parse(new JSONObject()
                .put("controller", "http://100.97.23.87:8790")
                .toString());
    }
}
