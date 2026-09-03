package ai.tigeriq.worker.v07;

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

/** Controller V1 client. No Android session token exists: lease/result/heartbeat use device proof directly. */
public final class TigerIqApiClient {
    private static final int CONNECT_TIMEOUT_MS = 12_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    static final int MAX_REQUEST_BYTES = 512_000;
    static final int MAX_RESPONSE_BYTES = 512_000;
    private static final long LEASE_TTL_MS = 120_000L;

    private final EmployeeDeviceStore.Profile profile;

    public TigerIqApiClient(EmployeeDeviceStore.Profile profile) {
        if (profile == null) throw new IllegalArgumentException("profile required");
        this.profile = profile;
    }

    public JSONObject requireControllerV1Ready() throws Exception {
        JSONObject status = request("GET", ControllerV1Contract.STATUS_PATH, null, false);
        ControllerV1Contract.requireCompatible(status);
        return status;
    }

    public LeaseResult leaseNextJob() throws Exception {
        JSONObject body = new JSONObject().put("leaseTtlMs", LEASE_TTL_MS);
        JSONObject response = request("POST", ControllerV1Contract.LEASE_PATH, body, true);
        if (!response.optBoolean("ok", false)) throw new ApiException(502, "INVALID_RESPONSE", "lease response missing ok=true", true, null);
        if (!response.has("lease") || response.isNull("lease")) return LeaseResult.empty();
        JSONObject lease = response.optJSONObject("lease");
        if (lease == null) throw new ApiException(502, "INVALID_RESPONSE", "lease object missing", true, null);

        String employeeId = required(lease, "employeeId");
        String deviceId = required(lease, "deviceId");
        if (!profile.employeeId.equals(employeeId) || !profile.deviceId.equals(deviceId)) {
            throw new ApiException(409, "IDENTITY_MISMATCH", "leased work identity does not match this phone", false, null);
        }
        String jobId = required(lease, "jobId");
        String bindingId = required(lease, "bindingId");
        String leaseId = required(lease, "leaseId");
        String leaseToken = required(lease, "leaseToken");
        String expiresAt = required(lease, "expiresAt");
        int attempt = lease.optInt("attempt", 0);
        if (attempt < 1) throw new ApiException(502, "INVALID_RESPONSE", "lease attempt invalid", true, null);
        JSONObject job = lease.optJSONObject("job");
        if (job == null) throw new ApiException(502, "INVALID_RESPONSE", "lease job missing", true, null);
        if (!jobId.equals(required(job, "jobId"))) throw new ApiException(409, "JOB_ID_MISMATCH", "lease/job id mismatch", false, null);
        String idempotencyKey = required(job, "idempotencyKey");
        long expiresAtEpochMs;
        try { expiresAtEpochMs = Instant.parse(expiresAt).toEpochMilli(); }
        catch (Exception error) { throw new ApiException(502, "INVALID_RESPONSE", "lease expiresAt invalid", true, null); }
        if (expiresAtEpochMs <= System.currentTimeMillis()) throw new ApiException(409, "LEASE_EXPIRED", "received lease already expired", true, null);

        DurableCheckpointStore.JobLease checkpoint = new DurableCheckpointStore.JobLease(
                jobId, idempotencyKey, bindingId, leaseId, leaseToken, expiresAtEpochMs, attempt, job.toString());
        return LeaseResult.leased(checkpoint);
    }

    public JSONObject submitResult(String jobId, JSONObject body) throws Exception {
        String path = ControllerV1Contract.resultPath(jobId);
        JSONObject response = request("POST", path, body, true);
        if (!response.optBoolean("ok", false)) throw new ApiException(502, "INVALID_RESPONSE", "result response missing ok=true", true, null);
        JSONObject accepted = response.optJSONObject("result");
        if (accepted == null) throw new ApiException(502, "INVALID_RESPONSE", "accepted result missing", true, null);
        String acceptedJobId = accepted.optString("jobId", "").trim();
        if (!acceptedJobId.isEmpty() && !jobId.equals(acceptedJobId)) throw new ApiException(409, "JOB_ID_MISMATCH", "accepted result belongs to another job", false, null);
        return response;
    }

    public JSONObject heartbeat(String health, JSONObject metadata) throws Exception {
        String safeHealth = health == null || health.isBlank() ? "degraded" : health.trim();
        JSONObject body = new JSONObject().put("health", safeHealth)
                .put("metadata", metadata == null ? new JSONObject() : metadata);
        JSONObject response = request("POST", ControllerV1Contract.heartbeatPath(profile.deviceId), body, true);
        if (response.length() > 0 && !response.optBoolean("ok", false)) throw new ApiException(502, "INVALID_RESPONSE", "heartbeat response missing ok=true", true, null);
        return response;
    }

    private JSONObject request(String method, String path, JSONObject body, boolean protectedRequest) throws Exception {
        byte[] bodyBytes = body == null ? new byte[0] : body.toString().getBytes(StandardCharsets.UTF_8);
        requireRequestWithinLimit(bodyBytes);
        HttpURLConnection connection = (HttpURLConnection) new URL(profile.controllerUrl + path).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        if (bodyBytes.length > 0) connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (protectedRequest) addDeviceProof(connection, method, path, bodyBytes);
        if (bodyBytes.length > 0) {
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bodyBytes.length);
            try (java.io.OutputStream output = connection.getOutputStream()) {
                output.write(bodyBytes);
                output.flush();
            }
        }

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        Long retryAfterMs = retryAfterMs(connection.getHeaderField("Retry-After"));
        byte[] responseBytes;
        try {
            responseBytes = stream == null ? new byte[0] : readLimited(stream);
        } finally {
            connection.disconnect();
        }
        String raw = new String(responseBytes, StandardCharsets.UTF_8);
        JSONObject decoded;
        try { decoded = raw.isBlank() ? new JSONObject() : new JSONObject(raw); }
        catch (Exception error) { throw new ApiException(status, "INVALID_RESPONSE", "Controller returned non-JSON response", status >= 500, retryAfterMs); }
        if (status < 200 || status >= 300) throw apiError(status, decoded, retryAfterMs);
        return decoded;
    }

    private void addDeviceProof(HttpURLConnection connection, String method, String path, byte[] bodyBytes) throws Exception {
        DeviceKeyStore deviceKey = new DeviceKeyStore(profile.employeeId, profile.deviceId);
        deviceKey.ensureKey();
        String fingerprint = deviceKey.publicKeyFingerprintSha256();
        if (!fingerprint.equalsIgnoreCase(profile.publicKeyFingerprint)) throw new ApiException(409, "DEVICE_KEY_CHANGED", "Android Keystore identity changed", false, null);
        String timestamp = Long.toString(System.currentTimeMillis());
        String nonce = UUID.randomUUID().toString();
        String bodyHash = sha256(bodyBytes);
        String canonical = method.toUpperCase(Locale.ROOT) + "\n" + path + "\n" + profile.employeeId + "\n" + profile.nodeId + "\n" + profile.deviceId + "\n" + timestamp + "\n" + nonce + "\n" + bodyHash;
        connection.setRequestProperty("X-TigerIQ-Device-Proof-V", "1");
        connection.setRequestProperty("X-TigerIQ-Employee-Id", profile.employeeId);
        connection.setRequestProperty("X-TigerIQ-Node-Id", profile.nodeId);
        connection.setRequestProperty("X-TigerIQ-Device-Id", profile.deviceId);
        connection.setRequestProperty("X-TigerIQ-Device-Key-Fingerprint", fingerprint.toLowerCase(Locale.ROOT));
        connection.setRequestProperty("X-TigerIQ-Device-Public-Key", deviceKey.publicKeyBase64());
        connection.setRequestProperty("X-TigerIQ-Device-Timestamp", timestamp);
        connection.setRequestProperty("X-TigerIQ-Device-Nonce", nonce);
        connection.setRequestProperty("X-TigerIQ-Device-Challenge", sha256(canonical.getBytes(StandardCharsets.UTF_8)));
        connection.setRequestProperty("X-TigerIQ-Device-Signature", deviceKey.signCanonical(canonical));
    }

    private static ApiException apiError(int status, JSONObject body, Long retryAfterMs) {
        JSONObject error = body.optJSONObject("error");
        String code = error == null ? "HTTP_" + status : error.optString("code", "HTTP_" + status);
        String message = error == null ? "Controller request failed" : error.optString("message", "Controller request failed");
        boolean retryable = status == 408 || status == 425 || status == 429 || status >= 500;
        if (error != null && error.has("retriable")) retryable = error.optBoolean("retriable", retryable);
        return new ApiException(status, code, message, retryable, retryAfterMs);
    }

    private static String required(JSONObject object, String key) throws ApiException {
        String value = object.optString(key, "").trim();
        if (value.isEmpty()) throw new ApiException(502, "INVALID_RESPONSE", "missing " + key, true, null);
        return value;
    }

    static void requireRequestWithinLimit(byte[] bytes) throws ApiException {
        int length = bytes == null ? 0 : bytes.length;
        if (length > MAX_REQUEST_BYTES) throw new ApiException(413, "REQUEST_TOO_LARGE", "Controller request exceeds safe limit", false, null);
    }

    static byte[] readLimited(InputStream stream) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_RESPONSE_BYTES) {
                    throw new ApiException(502, "RESPONSE_TOO_LARGE", "Controller response exceeds safe limit", false, null);
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder out = new StringBuilder(digest.length * 2);
        for (byte value : digest) out.append(String.format(Locale.ROOT, "%02x", value));
        return out.toString();
    }

    private static Long retryAfterMs(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try { return Math.max(0L, Long.parseLong(raw.trim()) * 1000L); }
        catch (Exception ignored) { return null; }
    }

    public static final class LeaseResult {
        public final boolean empty;
        public final DurableCheckpointStore.JobLease lease;
        private LeaseResult(boolean empty, DurableCheckpointStore.JobLease lease) { this.empty = empty; this.lease = lease; }
        static LeaseResult empty() { return new LeaseResult(true, null); }
        static LeaseResult leased(DurableCheckpointStore.JobLease lease) { return new LeaseResult(false, lease); }
    }
}
