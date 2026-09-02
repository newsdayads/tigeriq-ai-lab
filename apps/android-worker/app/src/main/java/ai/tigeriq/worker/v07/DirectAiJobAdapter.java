package ai.tigeriq.worker.v07;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;

/** Builds the canonical PC01 result envelope for AI execution performed on this phone. */
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

    public static JSONObject result(
            EmployeeDeviceStore.Profile profile,
            DurableCheckpointStore.Snapshot snapshot,
            ProviderExecution execution,
            JSONArray attempts,
            String jobStartedAt) throws Exception {
        requireBinding(profile, snapshot);
        JSONArray safeAttempts = attempts == null ? new JSONArray() : attempts;
        JSONArray errors = new JSONArray();
        for (int i = 0; i < safeAttempts.length(); i++) {
            JSONObject attempt = safeAttempts.optJSONObject(i);
            if (attempt != null && "error".equals(attempt.optString("status"))) {
                errors.put(new JSONObject()
                        .put("provider", attempt.optString("provider", ""))
                        .put("model", attempt.optString("model", ""))
                        .put("code", attempt.optString("errorCode", "PROVIDER_ERROR"))
                        .put("workerAttempt", attempt.optInt("workerAttempt", 0))
                        .put("at", attempt.optString("finishedAt", "")));
            }
        }
        String completedAt = Instant.now().toString();
        String canonical = snapshot.jobId + "\n" + execution.provider + "\n" + execution.model + "\n" + execution.text + "\n" + execution.finishedAt;
        String evidenceSha = WorkNames.sha256(canonical);
        JSONArray evidence = new JSONArray().put(new JSONObject()
                .put("kind", "json")
                .put("ref", "tigeriq://" + profile.employeeId + "/" + snapshot.jobId + "/phone-ai-result.json")
                .put("summary", "Phone executed AI provider directly; secret excluded")
                .put("sha256", evidenceSha));
        JSONObject timestamps = new JSONObject()
                .put("jobStartedAt", jobStartedAt)
                .put("providerStartedAt", execution.startedAt)
                .put("providerFinishedAt", execution.finishedAt)
                .put("completedAt", completedAt);
        JSONObject failover = new JSONObject()
                .put("used", safeAttempts.length() > 1)
                .put("strategy", "phone-local-provider-chain");
        return new JSONObject()
                .put("jobId", snapshot.jobId)
                .put("employeeId", profile.employeeId)
                .put("deviceId", profile.deviceId)
                .put("bindingId", profile.bindingId)
                .put("status", "completed")
                .put("output", execution.text)
                .put("provider", execution.provider)
                .put("model", execution.model)
                .put("timestamps", timestamps)
                .put("attempts", safeAttempts)
                .put("failover", failover)
                .put("errors", errors)
                .put("evidence", evidence);
    }

    public static JSONObject submitRequest(EmployeeDeviceStore.Profile profile, DurableCheckpointStore.Snapshot snapshot, String leaseToken, JSONObject result) throws Exception {
        requireBinding(profile, snapshot);
        if (leaseToken == null || leaseToken.isBlank()) throw new ApiException(409, "LEASE_REACQUIRE_REQUIRED", "process lease authority missing; reacquire from PC01", false, null);
        if (!profile.bindingId.equals(result.optString("bindingId", ""))) throw new ApiException(409, "STALE_BINDING", "result binding mismatch", false, null);
        return new JSONObject()
                .put("employeeId", profile.employeeId)
                .put("deviceId", profile.deviceId)
                .put("leaseId", snapshot.leaseId)
                .put("leaseToken", leaseToken)
                .put("result", result);
    }

    public static void requireBinding(EmployeeDeviceStore.Profile profile, DurableCheckpointStore.Snapshot snapshot) throws ApiException {
        if (profile == null || profile.bindingId == null || profile.bindingId.isBlank()) throw new ApiException(409, "BINDING_REQUIRED", "authoritative binding is not established", false, null);
        if (snapshot == null || snapshot.bindingId == null || !profile.bindingId.equals(snapshot.bindingId)) throw new ApiException(409, "STALE_BINDING", "checkpoint binding mismatch", false, null);
    }
}
