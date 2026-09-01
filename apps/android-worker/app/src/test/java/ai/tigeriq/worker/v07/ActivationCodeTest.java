package ai.tigeriq.worker.v07;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.Assert.assertEquals;

public class ActivationCodeTest {
    @Test public void parsesCanonicalSingleFieldBundle() throws Exception {
        JSONObject object = new JSONObject()
                .put("gateway", "https://gateway.tigeriq.test")
                .put("employeeId", "emp-001")
                .put("credentialId", "cred-001")
                .put("bootstrapToken", "one-time-secret");
        String encoded = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(object.toString().getBytes(StandardCharsets.UTF_8));

        ActivationCode.Bundle bundle = ActivationCode.parse("TIQ1." + encoded);
        assertEquals("https://gateway.tigeriq.test", bundle.gateway);
        assertEquals("EMP-001", bundle.employeeId);
        assertEquals("CRED-001", bundle.credentialId);
        assertEquals("one-time-secret", bundle.bootstrapToken);
    }

    @Test public void acceptsRawJsonForOperatorDiagnostics() throws Exception {
        String raw = new JSONObject()
                .put("gateway", "https://gateway.tigeriq.test/")
                .put("employeeId", "EMP-002")
                .put("credentialId", "CRED-002")
                .put("bootstrapToken", "token")
                .toString();
        ActivationCode.Bundle bundle = ActivationCode.parse(raw);
        assertEquals("https://gateway.tigeriq.test", bundle.gateway);
        assertEquals("EMP-002", bundle.employeeId);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsNonHttpsGateway() throws Exception {
        String raw = new JSONObject()
                .put("gateway", "http://example.test")
                .put("employeeId", "EMP-003")
                .put("credentialId", "CRED-003")
                .put("bootstrapToken", "token")
                .toString();
        ActivationCode.parse(raw);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsMissingBootstrap() throws Exception {
        String raw = new JSONObject()
                .put("gateway", "https://gateway.tigeriq.test")
                .put("employeeId", "EMP-004")
                .put("credentialId", "CRED-004")
                .toString();
        ActivationCode.parse(raw);
    }
}
