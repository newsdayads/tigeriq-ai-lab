package ai.tigeriq.worker.v07;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * One-field TigerIQ V1 activation bundle.
 * Canonical format: TIQ1.<base64url(JSON)> with controller, employeeId, credentialId, bootstrapToken.
 * `gateway` remains accepted only for migration from v0.7 activation generators.
 */
public final class ActivationCode {
    private static final String PREFIX = "TIQ1.";

    private ActivationCode() {}

    public static Bundle parse(String raw) {
        if (raw == null || raw.trim().isEmpty()) throw new IllegalArgumentException("activation code is required");
        String value = raw.trim();
        try {
            String json;
            if (value.startsWith(PREFIX)) {
                String payload = value.substring(PREFIX.length()).trim();
                if (payload.isEmpty()) throw new IllegalArgumentException("activation payload is empty");
                json = new String(Base64.getUrlDecoder().decode(payload), StandardCharsets.UTF_8);
            } else if (value.startsWith("{")) {
                json = value;
            } else {
                throw new IllegalArgumentException("unsupported activation code format");
            }
            JSONObject object = new JSONObject(json);
            String endpoint = object.optString("controller", "").trim();
            if (endpoint.isEmpty()) endpoint = required(object, "gateway");
            String controller = GatewayUrlPolicy.requireControllerUrl(endpoint);
            String employeeId = IdentityRules.requireId("employeeId", required(object, "employeeId"));
            String credentialId = IdentityRules.requireId("credentialId", required(object, "credentialId"));
            String bootstrapToken = required(object, "bootstrapToken");
            return new Bundle(controller, employeeId, credentialId, bootstrapToken);
        } catch (IllegalArgumentException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalArgumentException("activation code is invalid", error);
        }
    }

    private static String required(JSONObject object, String key) {
        String value = object.optString(key, "").trim();
        if (value.isEmpty()) throw new IllegalArgumentException(key + " is required");
        return value;
    }

    public static final class Bundle {
        public final String controller;
        public final String gateway;
        public final String employeeId;
        public final String credentialId;
        public final String bootstrapToken;

        Bundle(String controller, String employeeId, String credentialId, String bootstrapToken) {
            this.controller = controller;
            this.gateway = controller;
            this.employeeId = employeeId;
            this.credentialId = credentialId;
            this.bootstrapToken = bootstrapToken;
        }
    }
}
