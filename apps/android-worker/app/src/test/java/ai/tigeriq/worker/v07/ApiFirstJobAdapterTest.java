package ai.tigeriq.worker.v07;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class ApiFirstJobAdapterTest {
    private static EmployeeDeviceStore.Profile profile() {
        return new EmployeeDeviceStore.Profile("https://tigeriq.example", "EMP:001", "NODE-DEV-001", "DEV-001", "CRED-1", "a".repeat(64), true, 1L);
    }

    @Test public void mapsLockedPayloadToInferenceWithoutCredentials() throws Exception {
        JSONObject job = new JSONObject().put("jobId", "JOB-001").put("employeeId", "EMP:001")
                .put("payload", new JSONObject().put("kind", "general").put("prompt", "safe work"));
        JSONObject request = ApiFirstJobAdapter.inferenceRequest(profile(), job, "REQ-001");
        assertEquals("EMP:001", request.getString("employeeId"));
        assertEquals("JOB-001", request.getString("workId"));
        assertEquals("safe work", request.getJSONObject("task").getString("prompt"));
        assertEquals(3, request.getJSONObject("routing").getInt("maxAttempts"));
        String serialized = request.toString();
        assertFalse(serialized.contains("CRED-1"));
        assertFalse(serialized.toLowerCase().contains("api_key"));
    }

    @Test public void rejectsCrossEmployeePayload() throws Exception {
        JSONObject job = new JSONObject().put("jobId", "JOB-001").put("employeeId", "EMP_002")
                .put("payload", new JSONObject().put("prompt", "wrong identity"));
        boolean rejected = false;
        try { ApiFirstJobAdapter.inferenceRequest(profile(), job, "REQ-001"); }
        catch (ApiException error) { rejected = "IDENTITY_MISMATCH".equals(error.code); }
        assertTrue(rejected);
    }

    @Test public void buildsSanitizedContractResultAndSubmit() throws Exception {
        DurableCheckpointStore.Snapshot snapshot = new DurableCheckpointStore.Snapshot("JOB-001", "IDEMP-1", "BIND-1", "LEASE-1", "hash", DurableCheckpointStore.PHASE_INFERENCE, System.currentTimeMillis() + 60_000L, 1, "REQ-1", "INF-1", null, 1L);
        String sha = "b".repeat(64);
        JSONObject inference = new JSONObject()
                .put("result", new JSONObject().put("text", "done"))
                .put("evidence", new JSONObject().put("selectedBackendIdentity", "groq/model").put("attempts", new JSONArray()).put("outputSha256", sha));
        JSONObject result = ApiFirstJobAdapter.result(profile(), snapshot, inference);
        assertEquals("completed", result.getString("status"));
        assertEquals("BIND-1", result.getString("bindingId"));
        assertEquals(sha, result.getJSONArray("evidence").getJSONObject(0).getString("sha256"));
        JSONObject submit = ApiFirstJobAdapter.submitRequest(profile(), snapshot, "lease-token-12345678901234567890", result);
        assertEquals("LEASE-1", submit.getString("leaseId"));
        assertEquals("EMP:001", submit.getString("employeeId"));
    }
}
