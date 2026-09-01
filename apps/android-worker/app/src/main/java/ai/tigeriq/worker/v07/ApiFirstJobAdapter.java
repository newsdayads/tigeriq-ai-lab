package ai.tigeriq.worker.v07;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;

public final class ApiFirstJobAdapter {
    private ApiFirstJobAdapter() {}

    public static JSONObject inferenceRequest(EmployeeDeviceStore.Profile profile, JSONObject job, String requestId) throws Exception {
        if (profile == null || job == null) throw new IllegalArgumentException("profile/job required");
        String employeeId = required(job, "employeeId");
        if (!profile.employeeId.equals(employeeId)) throw new ApiException(409, "IDENTITY_MISMATCH", "job employee mismatch", false, null);
        JSONObject payload = job.optJSONObject("payload");
        if (payload == null) throw new ApiException(422, "UNSUPPORTED_PAYLOAD", "job payload required", false, null);
        String kind = payload.optString("kind", "general").trim();
        String prompt = payload.optString("prompt", "").trim();
        if (prompt.isEmpty()) throw new ApiException(422, "UNSUPPORTED_PAYLOAD", "payload.prompt required", false, null);
        String role = payload.optString("role", "executor").trim();
        String risk = payload.optString("risk", "low").trim();
        JSONArray distinct = payload.optJSONArray("requiredDistinctFrom");
        if (distinct == null) distinct = new JSONArray();
        return new JSONObject()
                .put("requestId", requestId)
                .put("employeeId", profile.employeeId)
                .put("workId", required(job, "jobId"))
                .put("role", role)
                .put("task", new JSONObject().put("kind", kind).put("risk", risk).put("prompt", prompt))
                .put("routing", new JSONObject().put("requiredDistinctFrom", distinct).put("maxAttempts", Math.min(3, Math.max(1, payload.optInt("maxRouteAttempts", 3)))))
                .put("budgetClass", payload.optString("budgetClass", "free-first"));
    }

    public static JSONObject result(EmployeeDeviceStore.Profile profile, DurableCheckpointStore.Snapshot snapshot, JSONObject job, JSONObject inferenceResponse) throws Exception {
        requireBinding(profile, snapshot);
        JSONObject resultBody = inferenceResponse.optJSONObject("result");
        JSONObject gatewayEvidence = inferenceResponse.optJSONObject("evidence");
        if (resultBody == null || gatewayEvidence == null) throw new ApiException(502, "INVALID_RESPONSE", "inference result/evidence missing", false, null);
        String text = resultBody.optString("text", "");
        String outputSha = gatewayEvidence.optString("outputSha256", "").trim();
        if (!outputSha.matches("^[a-fA-F0-9]{64}$")) outputSha = WorkNames.sha256(resultBody.toString());
        JSONObject output = new JSONObject().put("text", text)
                .put("backend", gatewayEvidence.optString("selectedBackendIdentity", ""))
                .put("attempts", gatewayEvidence.optJSONArray("attempts") == null ? new JSONArray() : gatewayEvidence.optJSONArray("attempts"));
        JSONArray evidence = new JSONArray().put(new JSONObject()
                .put("kind", "json")
                .put("ref", "tigeriq://" + profile.employeeId + "/" + snapshot.jobId + "/gateway-result.json")
                .put("summary", "Sanitized TigerIQ inference evidence")
                .put("sha256", outputSha));
        enforceExpectedEvidence(job, evidence);
        return new JSONObject().put("jobId", snapshot.jobId).put("employeeId", profile.employeeId).put("deviceId", profile.deviceId)
                .put("bindingId", profile.bindingId).put("status", "completed").put("output", output).put("evidence", evidence).put("completedAt", Instant.now().toString());
    }

    public static JSONObject submitRequest(EmployeeDeviceStore.Profile profile, DurableCheckpointStore.Snapshot snapshot, String leaseToken, JSONObject result) throws Exception {
        requireBinding(profile, snapshot);
        if (leaseToken == null || leaseToken.isBlank()) throw new ApiException(409, "LEASE_REACQUIRE_REQUIRED", "process lease authority missing; reacquire from server", false, null);
        if (!profile.bindingId.equals(result.optString("bindingId", ""))) throw new ApiException(409, "STALE_BINDING", "result binding mismatch", false, null);
        return new JSONObject().put("employeeId", profile.employeeId).put("deviceId", profile.deviceId).put("leaseId", snapshot.leaseId).put("leaseToken", leaseToken).put("result", result);
    }

    static void enforceExpectedEvidence(JSONObject job, JSONArray evidence) throws ApiException {
        JSONArray expected = job == null ? null : job.optJSONArray("expectedEvidence");
        if (expected == null) throw new ApiException(422, "EXPECTED_EVIDENCE_MISSING", "job expectedEvidence required", false, null);
        for (int i = 0; i < expected.length(); i++) {
            String requirement = expected.optString(i, "").trim();
            if (requirement.isEmpty()) continue;
            boolean matched = false;
            for (int j = 0; j < evidence.length(); j++) {
                JSONObject artifact = evidence.optJSONObject(j);
                if (artifact == null) continue;
                String kind = artifact.optString("kind", "");
                String ref = artifact.optString("ref", "");
                if (requirement.equals(kind) || ref.contains(requirement)) { matched = true; break; }
            }
            if (!matched) throw new ApiException(422, "EXPECTED_EVIDENCE_UNMET", "missing expected evidence " + requirement, false, null);
        }
    }

    static void requireBinding(EmployeeDeviceStore.Profile profile, DurableCheckpointStore.Snapshot snapshot) throws ApiException {
        if (profile == null || profile.bindingId == null || profile.bindingId.isBlank()) throw new ApiException(409, "BINDING_REQUIRED", "authoritative binding is not established", false, null);
        if (snapshot == null || snapshot.bindingId == null || !profile.bindingId.equals(snapshot.bindingId)) throw new ApiException(409, "STALE_BINDING", "checkpoint binding mismatch", false, null);
    }

    private static String required(JSONObject object, String key) throws ApiException {
        String value = object.optString(key, "").trim();
        if (value.isEmpty()) throw new ApiException(422, "UNSUPPORTED_PAYLOAD", "missing " + key, false, null);
        return value;
    }
}
