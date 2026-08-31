package ai.tigeriq.worker.v07;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

public final class TigerIqApiClient {
    public static final String SESSION_PATH = "/v1/inference/sessions", INFERENCE_PATH = "/v1/inference", PULL_PATH = "/v1/android/jobs/pull", SUBMIT_PATH = "/v1/android/jobs/submit";
    private static final int MAX_RESPONSE_BYTES = 512_000, CONNECT_TIMEOUT_MS = 15_000;
    private final EmployeeDeviceStore.Profile profile; private final DeviceKeyStore deviceKey;
    public TigerIqApiClient(EmployeeDeviceStore.Profile profile) { if (profile == null) throw new IllegalArgumentException("profile required"); this.profile = profile; this.deviceKey = new DeviceKeyStore(profile.employeeId, profile.deviceId); }
    public Session mintSession(String bootstrapToken) throws Exception {
        JSONObject body = new JSONObject().put("employeeId", profile.employeeId).put("nodeId", profile.nodeId).put("deviceId", profile.deviceId).put("requestedScopes", new JSONArray().put("inference:invoke")).put("client", new JSONObject().put("name", "tigeriq-android-worker").put("version", "0.7.0"));
        JSONObject response = request("POST", SESSION_PATH, body, Headers.bootstrap(profile.credentialId, bootstrapToken), 30_000); JSONObject session = response.optJSONObject("session"); if (session == null) throw new ApiException(502, "INVALID_RESPONSE", "missing session response", false, null);
        String accessToken = required(session, "accessToken"), employeeId = required(session, "employeeId"), nodeId = required(session, "nodeId"), deviceId = session.optString("deviceId", profile.deviceId);
        if (!profile.employeeId.equals(employeeId) || !profile.nodeId.equals(nodeId) || !profile.deviceId.equals(deviceId)) throw new ApiException(409, "IDENTITY_MISMATCH", "session identity mismatch", false, null);
        return new Session(accessToken, parseInstant(required(session, "expiresAt")));
    }
    public PullResult pullJob(String bootstrapToken) throws Exception {
        JSONObject response = request("POST", PULL_PATH, new JSONObject().put("employeeId", profile.employeeId).put("deviceId", profile.deviceId), Headers.bootstrap(profile.credentialId, bootstrapToken), 30_000); JSONObject payload = unwrapData(response); String kind = payload.optString("kind", ""); if ("empty".equals(kind)) return PullResult.empty(); JSONObject lease = payload.optJSONObject("lease"); if (!"job".equals(kind) || lease == null) throw new ApiException(502, "INVALID_RESPONSE", "invalid pull response", false, null);
        if (!profile.employeeId.equals(required(lease, "employeeId")) || !profile.deviceId.equals(required(lease, "deviceId"))) throw new ApiException(409, "IDENTITY_MISMATCH", "job lease identity mismatch", false, null);
        JSONObject job = lease.optJSONObject("job"); if (job == null) throw new ApiException(502, "INVALID_RESPONSE", "lease missing job", false, null); String jobId = required(lease, "jobId"); if (!jobId.equals(required(job, "jobId"))) throw new ApiException(409, "IDENTITY_MISMATCH", "lease job mismatch", false, null);
        return PullResult.job(new DurableCheckpointStore.JobLease(jobId, required(job, "idempotencyKey"), required(lease, "bindingId"), required(lease, "leaseId"), required(lease, "leaseToken"), parseInstant(required(lease, "expiresAt")), lease.optInt("attempt", 1), job.toString()));
    }
    public JSONObject invokeInference(String accessToken, JSONObject inferenceRequest, String idempotencyKey) throws Exception { if (idempotencyKey == null || idempotencyKey.isBlank()) throw new IllegalArgumentException("idempotency key required"); JSONObject response = request("POST", INFERENCE_PATH, inferenceRequest, Headers.session(accessToken).put("Idempotency-Key", idempotencyKey), 135_000); if (!response.optBoolean("ok", true)) throw errorFromBody(502, response, false); return response; }
    public JSONObject submitResult(String bootstrapToken, JSONObject submitRequest) throws Exception { JSONObject response = request("POST", SUBMIT_PATH, submitRequest, Headers.bootstrap(profile.credentialId, bootstrapToken), 30_000); JSONObject payload = unwrapData(response); if (payload.has("accepted") && !payload.optBoolean("accepted")) throw new ApiException(409, "RESULT_REJECTED", "result was not accepted", false, null); return payload; }
    private JSONObject request(String method, String path, JSONObject body, Headers headers, int readTimeoutMs) throws Exception {
        URL url = new URL(GatewayUrlPolicy.requireHttps(profile.gatewayUrl) + path); byte[] bodyBytes = body == null ? new byte[0] : body.toString().getBytes(StandardCharsets.UTF_8); HttpURLConnection connection = (HttpURLConnection) url.openConnection(); connection.setRequestMethod(method); connection.setConnectTimeout(CONNECT_TIMEOUT_MS); connection.setReadTimeout(readTimeoutMs); connection.setUseCaches(false); connection.setDoInput(true); connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8"); connection.setRequestProperty("Cache-Control", "no-store");
        for (java.util.Iterator<String> it = headers.values.keys(); it.hasNext();) { String name = it.next(); connection.setRequestProperty(name, headers.values.optString(name)); }
        addDeviceProof(connection, method, path, bodyBytes); if (bodyBytes.length > 0) { connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bodyBytes.length); try (java.io.OutputStream out = connection.getOutputStream()) { out.write(bodyBytes); } }
        int status; byte[] responseBytes; try { status = connection.getResponseCode(); InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(); responseBytes = readLimited(stream); } finally { connection.disconnect(); }
        JSONObject response; try { response = responseBytes.length == 0 ? new JSONObject() : new JSONObject(new String(responseBytes, StandardCharsets.UTF_8)); } catch (Exception parse) { throw new ApiException(status, "INVALID_RESPONSE", "TigerIQ returned invalid JSON", status >= 500, null); }
        if (status < 200 || status >= 300) throw errorFromBody(status, response, status == 429 || status >= 500); return response;
    }
    private void addDeviceProof(HttpURLConnection connection, String method, String path, byte[] body) throws Exception {
        long timestamp = System.currentTimeMillis(); String nonce = UUID.randomUUID().toString(); String bodyHash = sha256(body); String canonical = method + "\n" + path + "\n" + profile.employeeId + "\n" + profile.nodeId + "\n" + profile.deviceId + "\n" + timestamp + "\n" + nonce + "\n" + bodyHash;
        connection.setRequestProperty("X-TigerIQ-Device-Proof-V", "1"); connection.setRequestProperty("X-TigerIQ-Employee-Id", profile.employeeId); connection.setRequestProperty("X-TigerIQ-Node-Id", profile.nodeId); connection.setRequestProperty("X-TigerIQ-Device-Id", profile.deviceId); connection.setRequestProperty("X-TigerIQ-Device-Key-Fingerprint", deviceKey.publicKeyFingerprintSha256()); connection.setRequestProperty("X-TigerIQ-Device-Public-Key", deviceKey.publicKeyBase64()); connection.setRequestProperty("X-TigerIQ-Device-Timestamp", Long.toString(timestamp)); connection.setRequestProperty("X-TigerIQ-Device-Nonce", nonce); connection.setRequestProperty("X-TigerIQ-Device-Challenge", sha256(canonical.getBytes(StandardCharsets.UTF_8))); connection.setRequestProperty("X-TigerIQ-Device-Signature", deviceKey.signCanonical(canonical));
    }
    private static JSONObject unwrapData(JSONObject response) { JSONObject data = response.optJSONObject("data"); return data == null ? response : data; }
    private static ApiException errorFromBody(int status, JSONObject body, boolean defaultRetryable) { JSONObject error = body.optJSONObject("error"); if (error == null) return new ApiException(status, "HTTP_" + status, "TigerIQ request failed", defaultRetryable, null); String code = error.optString("code", "HTTP_" + status), message = error.optString("message", "TigerIQ request failed"); boolean retryable = error.has("retryable") ? error.optBoolean("retryable") : defaultRetryable; Long retryAfterMs = error.has("retryAfterMs") && !error.isNull("retryAfterMs") ? error.optLong("retryAfterMs") : null; return new ApiException(status, code, message, retryable, retryAfterMs); }
    private static String required(JSONObject object, String key) throws ApiException { String value = object.optString(key, "").trim(); if (value.isEmpty()) throw new ApiException(502, "INVALID_RESPONSE", "missing " + key, false, null); return value; }
    private static long parseInstant(String value) throws ApiException { try { return Instant.parse(value).toEpochMilli(); } catch (Exception error) { throw new ApiException(502, "INVALID_RESPONSE", "invalid timestamp", false, null); } }
    private static byte[] readLimited(InputStream stream) throws Exception { if (stream == null) return new byte[0]; try (InputStream input = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) { byte[] buffer = new byte[8192]; int total = 0, read; while ((read = input.read(buffer)) >= 0) { total += read; if (total > MAX_RESPONSE_BYTES) throw new ApiException(502, "RESPONSE_TOO_LARGE", "TigerIQ response too large", false, null); out.write(buffer, 0, read); } return out.toByteArray(); } }
    private static String sha256(byte[] bytes) throws Exception { byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes); StringBuilder out = new StringBuilder(digest.length * 2); for (byte b : digest) out.append(String.format(Locale.ROOT, "%02x", b)); return out.toString(); }
    public static final class Session { public final String accessToken; public final long expiresAtEpochMs; Session(String accessToken, long expiresAtEpochMs) { this.accessToken = accessToken; this.expiresAtEpochMs = expiresAtEpochMs; } }
    public static final class PullResult { public final boolean empty; public final DurableCheckpointStore.JobLease lease; private PullResult(boolean empty, DurableCheckpointStore.JobLease lease) { this.empty = empty; this.lease = lease; } static PullResult empty() { return new PullResult(true, null); } static PullResult job(DurableCheckpointStore.JobLease lease) { return new PullResult(false, lease); } }
    private static final class Headers { final JSONObject values = new JSONObject(); static Headers bootstrap(String credentialId, String bearer) { return new Headers().put("Authorization", "Bearer " + requireSecret(bearer)).put("X-TigerIQ-Credential-Id", requireSecret(credentialId)); } static Headers session(String bearer) { return new Headers().put("Authorization", "Bearer " + requireSecret(bearer)); } Headers put(String name, String value) { values.put(name, value); return this; } private static String requireSecret(String value) { if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("credential is required"); return value.trim(); } }
}
