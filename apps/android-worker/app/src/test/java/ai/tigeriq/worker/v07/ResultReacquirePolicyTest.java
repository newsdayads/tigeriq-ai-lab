package ai.tigeriq.worker.v07;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public final class ResultReacquirePolicyTest {
    private static DurableCheckpointStore.Snapshot snapshot() {
        return new DurableCheckpointStore.Snapshot(
                "JOB-001", "IDEM-001", "BIND-001", "LEASE-OLD", "hash",
                DurableCheckpointStore.PHASE_RESULT_READY, 1L, 1,
                "EXEC-001", "AI-001", "evidence", 1L);
    }

    private static DurableCheckpointStore.JobLease lease(String jobId, String idempotencyKey, String bindingId) {
        return new DurableCheckpointStore.JobLease(
                jobId, idempotencyKey, bindingId, "LEASE-NEW", "raw-process-token",
                10_000L, 2, "{\"jobId\":\"" + jobId + "\"}");
    }

    @Test public void preservesOnlyCompletedResultPhases() {
        assertTrue(ResultReacquirePolicy.isPersistedResultPhase(DurableCheckpointStore.PHASE_RESULT_READY));
        assertTrue(ResultReacquirePolicy.isPersistedResultPhase(DurableCheckpointStore.PHASE_SUBMITTING));
        assertFalse(ResultReacquirePolicy.isPersistedResultPhase(DurableCheckpointStore.PHASE_LEASED));
        assertFalse(ResultReacquirePolicy.isPersistedResultPhase(DurableCheckpointStore.PHASE_AI_EXECUTION));
    }

    @Test public void acceptsFreshLeaseOnlyForExactSameWorkIdentity() throws Exception {
        ResultReacquirePolicy.requireSameWork(snapshot(), lease("JOB-001", "IDEM-001", "BIND-001"));
    }

    @Test public void rejectsJobIdempotencyOrBindingDrift() throws Exception {
        assertMismatch(lease("JOB-OTHER", "IDEM-001", "BIND-001"));
        assertMismatch(lease("JOB-001", "IDEM-OTHER", "BIND-001"));
        assertMismatch(lease("JOB-001", "IDEM-001", "BIND-OTHER"));
    }

    private static void assertMismatch(DurableCheckpointStore.JobLease lease) throws Exception {
        try {
            ResultReacquirePolicy.requireSameWork(snapshot(), lease);
            fail("expected RESULT_REACQUIRE_MISMATCH");
        } catch (ApiException error) {
            if (!"RESULT_REACQUIRE_MISMATCH".equals(error.code)) throw error;
        }
    }
}
