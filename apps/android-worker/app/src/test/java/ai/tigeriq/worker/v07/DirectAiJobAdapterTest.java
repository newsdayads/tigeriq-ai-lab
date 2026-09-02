package ai.tigeriq.worker.v07;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.*;

public final class DirectAiJobAdapterTest {
    private static EmployeeDeviceStore.Profile profile() {
        return new EmployeeDeviceStore.Profile("https://pc01.tigeriq.example", "EMP:001", "NODE-DEV-001", "DEV-001", "CRED-1", "BIND-1", "a".repeat(64), true, 1L);
    }

    private static DurableCheckpointStore.Snapshot snapshot() {
        return new DurableCheckpointStore.Snapshot("JOB-001", "IDEMP-1", "BIND-1", "LEASE-1", "hash", DurableCheckpointStore.PHASE_AI_EXECUTION, System.currentTimeMillis() + 60_000L, 1, "EXEC-1", "AI-1", null, 1L);
    }

    @Test public void extractsPromptFromPc01Job() throws Exception {
        JSONObject job = new JSONObject().put("payload", new JSONObject().put("prompt", "do useful work"));
        assertEquals("do useful work", DirectAiJobAdapter.requiredPrompt(job));
    }

    @Test public void buildsRequiredV1ResultEnvelopeWithoutSecrets() throws Exception {
        JSONArray attempts = new JSONArray().put(new JSONObject()
                .put("provider", "gemini").put("model", "gemini-test").put("workerAttempt", 1)
                .put("status", "success").put("startedAt", "2026-09-02T00:00:00Z").put("finishedAt", "2026-09-02T00:00:01Z").put("errorCode", ""));
        ProviderExecution execution = new ProviderExecution("gemini", "gemini-test", "DONE", "2026-09-02T00:00:00Z", "2026-09-02T00:00:01Z");
        JSONObject result = DirectAiJobAdapter.result(profile(), snapshot(), execution, attempts, "2026-09-02T00:00:00Z");
        assertEquals("JOB-001", result.getString("jobId"));
        assertEquals("DONE", result.getString("output"));
        assertEquals("gemini", result.getString("provider"));
        assertEquals("gemini-test", result.getString("model"));
        assertTrue(result.has("timestamps"));
        assertTrue(result.has("attempts"));
        assertTrue(result.has("failover"));
        assertTrue(result.has("errors"));
        assertTrue(result.has("evidence"));
        String serialized = result.toString();
        assertFalse(serialized.contains("CRED-1"));
        assertFalse(serialized.toLowerCase().contains("api key"));
    }

    @Test public void submitCarriesLeaseAndStandardResult() throws Exception {
        ProviderExecution execution = new ProviderExecution("gemini", "gemini-test", "DONE", "a", "b");
        JSONObject result = DirectAiJobAdapter.result(profile(), snapshot(), execution, new JSONArray(), "a");
        JSONObject submit = DirectAiJobAdapter.submitRequest(profile(), snapshot(), "LEASE-TOKEN-SECRET", result);
        assertEquals("EMP:001", submit.getString("employeeId"));
        assertEquals("LEASE-1", submit.getString("leaseId"));
        assertEquals("JOB-001", submit.getJSONObject("result").getString("jobId"));
    }
}
