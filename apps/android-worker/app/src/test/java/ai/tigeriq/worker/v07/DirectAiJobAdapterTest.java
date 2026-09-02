package ai.tigeriq.worker.v07;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.*;

public final class DirectAiJobAdapterTest {
    private static EmployeeDeviceStore.Profile profile() {
        return new EmployeeDeviceStore.Profile(ControllerV1Contract.CONTROLLER_TAILSCALE_HTTP_BASE, "EMP:001", "NODE-DEV-001", "DEV-001", "CONTROLLER-V1", "BIND-1", "a".repeat(64), true, 1L);
    }

    private static DurableCheckpointStore.Snapshot snapshot() {
        return new DurableCheckpointStore.Snapshot("JOB-001", "IDEMP-1", "BIND-1", "LEASE-1", "hash", DurableCheckpointStore.PHASE_AI_EXECUTION, System.currentTimeMillis() + 60_000L, 1, "EXEC-1", "AI-1", null, 1L);
    }

    @Test public void extractsPromptFromControllerJob() throws Exception {
        JSONObject job = new JSONObject().put("payload", new JSONObject().put("prompt", "do useful work"));
        assertEquals("do useful work", DirectAiJobAdapter.requiredPrompt(job));
    }

    @Test public void buildsCanonical116CompletedResultWithoutSecrets() throws Exception {
        JSONArray attempts = new JSONArray().put(new JSONObject()
                .put("provider", "gemini").put("model", "gemini-test").put("workerAttempt", 1)
                .put("status", "success").put("startedAt", "2026-09-02T00:00:00Z").put("finishedAt", "2026-09-02T00:00:01Z").put("errorCode", ""));
        ProviderExecution execution = new ProviderExecution("gemini", "gemini-test", "DONE", "2026-09-02T00:00:00Z", "2026-09-02T00:00:01Z");
        JSONObject result = DirectAiJobAdapter.completedResult(profile(), snapshot(), execution, attempts, "2026-09-02T00:00:00Z");
        assertEquals("completed", result.getString("status"));
        assertTrue(result.has("completedAt"));
        JSONObject output = result.getJSONObject("output");
        assertEquals("DONE", output.getString("text"));
        assertEquals("gemini", output.getString("provider"));
        assertEquals("gemini-test", output.getString("model"));
        assertTrue(output.has("timestamps"));
        assertTrue(output.get("attempts") instanceof JSONArray);
        assertTrue(output.has("failover"));
        assertTrue(output.has("errors"));
        assertTrue(result.has("evidence"));
        assertFalse(result.has("jobId"));
        assertFalse(result.has("employeeId"));
        String serialized = result.toString();
        assertFalse(serialized.contains("CONTROLLER-V1"));
        assertFalse(serialized.toLowerCase().contains("api key"));
        assertFalse(serialized.toLowerCase().contains("lease-token"));
    }

    @Test public void submitBodyIsExactlyLeaseAuthorityPlusResult() throws Exception {
        ProviderExecution execution = new ProviderExecution("gemini", "gemini-test", "DONE", "a", "b");
        JSONObject result = DirectAiJobAdapter.completedResult(profile(), snapshot(), execution, new JSONArray(), "a");
        JSONObject submit = DirectAiJobAdapter.submitRequest(profile(), snapshot(), "LEASE-TOKEN-SECRET", result);
        assertEquals(3, submit.length());
        assertEquals("LEASE-1", submit.getString("leaseId"));
        assertEquals("LEASE-TOKEN-SECRET", submit.getString("leaseToken"));
        assertEquals("completed", submit.getJSONObject("result").getString("status"));
        assertFalse(submit.has("employeeId"));
        assertFalse(submit.has("deviceId"));
    }

    @Test public void buildsCanonical116FailureResult() throws Exception {
        JSONArray attempts = new JSONArray().put(new JSONObject()
                .put("provider", "gemini").put("model", "gemini-test").put("workerAttempt", 5)
                .put("status", "error").put("startedAt", "a").put("finishedAt", "b").put("errorCode", "PROVIDER_LIMIT"));
        JSONObject result = DirectAiJobAdapter.failedResult(profile(), snapshot(), "gemini", "gemini-test", attempts,
                "a", "a", "b", "PROVIDER_LIMIT", "quota exhausted", false);
        assertEquals("failed", result.getString("status"));
        assertEquals("PROVIDER_LIMIT", result.getJSONObject("failure").getString("code"));
        assertEquals(1, result.getJSONObject("output").getJSONArray("errors").length());
        assertEquals("gemini", result.getJSONObject("output").getString("provider"));
    }
}
