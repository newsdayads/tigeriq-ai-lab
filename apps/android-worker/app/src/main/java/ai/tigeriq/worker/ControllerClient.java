package ai.tigeriq.worker;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Minimal HTTPS transport for pairing, heartbeat, lease polling and structured result publishing. */
public final class ControllerClient {
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 20_000;

    private final SecureCredentialStore store;

    public ControllerClient(SecureCredentialStore store) {
        this.store = store;
    }

    public JSONObject pair(
        String controllerUrl,
        String challengeId,
        String challenge,
        String nodeId,
        String platform,
        String agentVersion,
        String[] capabilities
    ) throws Exception {
        requireHttps(controllerUrl);
        JSONObject request = new JSONObject();
        request.put("challengeId", required(challengeId, "challengeId"));
        request.put("nodeId", required(nodeId, "nodeId"));
        request.put("publicKey", WorkerIdentity.publicKeyBase64());
        request.put("proof", WorkerIdentity.signChallengeBase64Url(challenge));
        request.put("kind", "android");
        request.put("platform", required(platform, "platform"));
        request.put("agentVersion", required(agentVersion, "agentVersion"));
        request.put("capabilities", new JSONArray(capabilities));

        JSONObject response = post(controllerUrl, "/api/node/pair", request, null);
        JSONObject credential = response.getJSONObject("credential");
        store.save(controllerUrl, credential.getString("credentialId"), credential.getString("token"));
        return response;
    }

    public JSONObject heartbeat(int batteryPct, Double temperatureC, String agentVersion) throws Exception {
        JSONObject request = new JSONObject();
        request.put("status", "online");
        request.put("batteryPct", Math.max(0, Math.min(100, batteryPct)));
        if (temperatureC != null) request.put("temperatureC", temperatureC);
        if (agentVersion != null && !agentVersion.trim().isEmpty()) request.put("agentVersion", agentVersion.trim());
        return authenticatedPost("/api/node/heartbeat", request);
    }

    public JSONObject pollLease() throws Exception {
        return authenticatedPost("/api/node/tasks/lease", new JSONObject());
    }

    public JSONObject submitResult(String taskId, String leaseId, String leaseToken, JSONObject result) throws Exception {
        JSONObject request = new JSONObject();
        request.put("taskId", required(taskId, "taskId"));
        request.put("leaseId", required(leaseId, "leaseId"));
        request.put("leaseToken", required(leaseToken, "leaseToken"));
        request.put("result", result);
        return authenticatedPost("/api/node/tasks/result", request);
    }

    private JSONObject authenticatedPost(String path, JSONObject body) throws Exception {
        SecureCredentialStore.Credential credential = store.load();
        if (credential == null) throw new IllegalStateException("worker is not paired");
        requireHttps(credential.controllerUrl);
        return post(credential.controllerUrl, path, body, credential);
    }

    private static JSONObject post(
        String controllerUrl,
        String path,
        JSONObject body,
        SecureCredentialStore.Credential credential
    ) throws Exception {
        URL url = new URL(controllerUrl + path);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IllegalArgumentException("controller transport must use HTTPS");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        if (credential != null) {
            connection.setRequestProperty("X-TigerIQ-Credential-Id", credential.credentialId);
            connection.setRequestProperty("Authorization", "Bearer " + credential.token);
        }

        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String payload = read(stream);
        connection.disconnect();
        if (status < 200 || status >= 300) {
            throw new ControllerException(status, payload.length() > 512 ? payload.substring(0, 512) : payload);
        }
        return payload.isEmpty() ? new JSONObject() : new JSONObject(payload);
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (out.length() + line.length() > 64_000) throw new IllegalStateException("controller response too large");
                out.append(line);
            }
        }
        return out.toString();
    }

    private static void requireHttps(String url) {
        if (url == null || !url.startsWith("https://")) throw new IllegalArgumentException("controller URL must use HTTPS");
    }

    private static String required(String value, String name) {
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException(name + " is required");
        return value.trim();
    }

    public static final class ControllerException extends Exception {
        public final int status;
        ControllerException(int status, String message) {
            super("controller HTTP " + status + (message.isEmpty() ? "" : ": " + message));
            this.status = status;
        }
    }
}
