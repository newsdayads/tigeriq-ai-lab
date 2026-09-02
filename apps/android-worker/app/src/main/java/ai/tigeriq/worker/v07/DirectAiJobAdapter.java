package ai.tigeriq.worker.v07;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;

/** Builds the canonical PR #116 result envelope for AI execution performed on this phone. */
public final class DirectAiJobAdapter {
    private DirectAiJobAdapter() {}

    public static String requiredPrompt(JSONObject job) throws ApiException {
        if (job == null) throw new ApiException(422, "JOB_MISSING", "job required", false, null);
        JSONObject payload = job.optJSONObject("payload");
        if (payload == null) throw new ApiException(422, "UNSUPPORTED_PAYLOAD", "job payload required", false, null);
        String prompt = payload.optString("prompt", "").trim();
        if (prompt.isEmpty()) throw new ApiException(422, "UNSUPPORTED_PAYLOAD", "payload.prompt required", false, null);
        return prompt;
    }

    public static JSONObject completedResult(
            EmployeeDeviceStore.Profile profile,
            DurableCheckpointStore.Snapshot snapshot,
            ProviderExecution execution,
            JSONArray attempts,
            String jobStartedAt) throws Exception {
        requireBinding(profile, snapshot);
        JSONArray safeAttempts = copy(attempts);
        String completedAt = Instant.now().toString();
        JSONObject output = output(execution.text, execution.provider, execution.model, jobStartedAt,
                execution.startedAt, execution.finishedAt, completedAt, safeAttempts);
        JSONArray evidence = evidence(profile, snapshot, execution.provider, execution.model, execution.text, completedAt, "Phone executed provider directly; secret excluded");
        return new JSONObject()
                .put("status", "completed")
                .put("completedAt", completedAt)
                .put("output", output)
                .put("evidence", evidence);
    }

    public static JSONObject failedResult(
            EmployeeDeviceStore.Profile profile,
            DurableCheckpointStore.Snapshot snapshot,
            String provider,
            String model,
            JSONArray attempts,
            String jobStartedAt,
            String providerStartedAt,
            String providerFinishedAt,
            String code,
            String message,
            boolean retriable) throws Exception {
        requireBinding(profile, snapshot);
        JSONArray safeAttempts = copy(attempts);
        String completedAt = Instant.now().toString();
        JSONObject output = output("", safe(provider), safe(model), jobStartedAt, providerStartedAt, providerFinishedAt, completedAt, safeAttempts);
        JSONArray evidence = evidence(profile, snapshot, safe(provider), safe(model), safe(code), completedAt, "Phone provider execution failed; secret excluded");
        return new JSONObject()
                .put("status", "failed")
                .put("completedAt", completedAt)
                .put("output", output)
                .put("failure", new JSONObject()
                        .put("code", safe(code).isEmpty() ? "PROVIDER_ERROR" : safe(code))
                        .put("message", sanitizeMessage(message))
                        .put("retriable", retriable))
                .put("evidence", evidence);
    }

    public static JSONObject submitRequest(EmployeeDeviceStore.Profile profile, DurableCheckpointStore.Snapshot snapshot, String leaseToken, JSONObject result) throws Exception {
        requireBinding(profile, snapshot);
        if (leaseToken == null || leaseToken.isBlank()) throw new ApiException(409, "LEASE_REACQUIRE_REQUIRED", "process lease authority missing; reacquire from PC01", false, null);
        if (result == null) throw new IllegalArgumentException("result required");
        return new JSONObject()
                .put("leaseId", snapshot.leaseId)
                .put("leaseToken", leaseToken)
                .put("result", result);
    }

    public static void requireBinding(EmployeeDeviceStore.Profile profile, DurableCheckpointStore.Snapshot snapshot) throws ApiException {
        if (profile == null || profile.bindingId == null || profile.bindingId.isBlank()) throw new ApiException(409, "BINDING_REQUIRED", "authoritative binding is not established", false, null);
        if (snapshot == null || snapshot.bindingId == null || !profile.bindingId.equals(snapshot.bindingId)) throw new ApiException(409, "STALE_BINDING", "checkpoint binding mismatch", false, null);
    }

    private static JSONObject output(String text, String provider, String model, String jobStartedAt,
                                     String providerStartedAt, String providerFinishedAt, String completedAt,
                                     JSONArray attempts) throws Exception {
        JSONObject timestamps = new JSONObject()
                .put("jobStartedAt", safe(jobStartedAt))
                .put("providerStartedAt", safe(providerStartedAt))
                .put("providerFinishedAt", safe(providerFinishedAt))
                .put("completedAt", completedAt);
        JSONObject failover = new JSONObject()
                .put("used", distinctProviders(attempts) > 1)
                .put("strategy", "phone-local-provider-chain");
        return new JSONObject()
                .put("text", safe(text))
                .put("provider", safe(provider))
                .put("model", safe(model))
                .put("timestamps", timestamps)
                .put("attempts", attempts)
                .put("failover", failover)
                .put("errors", errors(attempts));
    }

    private static JSONArray evidence(EmployeeDeviceStore.Profile profile, DurableCheckpointStore.Snapshot snapshot,
                                      String provider, String model, String material, String completedAt, String summary) throws Exception {
        String canonical = snapshot.jobId + "\n" + safe(provider) + "\n" + safe(model) + "\n" + safe(material) + "\n" + completedAt;
        return new JSONArray().put(new JSONObject()
                .put("kind", "json")
                .put("ref", "tigeriq://" + profile.employeeId + "/" + snapshot.jobId + "/phone-ai-result.json")
                .put("summary", summary)
                .put("sha256", WorkNames.sha256(canonical)));
    }

    private static JSONArray errors(JSONArray attempts) throws Exception {
        JSONArray errors = new JSONArray();
        for (int i = 0; i < attempts.length(); i++) {
            JSONObject attempt = attempts.optJSONObject(i);
            if (attempt != null && "error".equals(attempt.optString("status"))) {
                errors.put(new JSONObject()
                        .put("provider", attempt.optString("provider", ""))
                        .put("model", attempt.optString("model", ""))
                        .put("code", attempt.optString("errorCode", "PROVIDER_ERROR"))
                        .put("workerAttempt", attempt.optInt("workerAttempt", 0))
                        .put("at", attempt.optString("finishedAt", "")));
            }
        }
        return errors;
    }

    private static int distinctProviders(JSONArray attempts) {
        java.util.HashSet<String> providers = new java.util.HashSet<>();
        for (int i = 0; i < attempts.length(); i++) {
            JSONObject attempt = attempts.optJSONObject(i);
            if (attempt != null) {
                String provider = attempt.optString("provider", "").trim();
                if (!provider.isEmpty()) providers.add(provider);
            }
        }
        return providers.size();
    }

    private static JSONArray copy(JSONArray source) {
        try { return source == null ? new JSONArray() : new JSONArray(source.toString()); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    private static String sanitizeMessage(String value) {
        String safe = safe(value);
        if (safe.length() > 240) safe = safe.substring(0, 240);
        return safe.replaceAll("(?i)(api[_ -]?key|authorization|bearer|token)\\s*[:=]\\s*[^\\s,;]+", "$1=[REDACTED]");
    }

    private static String safe(String value) { return value == null ? "" : value; }
}
