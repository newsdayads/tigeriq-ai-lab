package ai.tigeriq.worker.v07;

/** Pure fail-closed policy for reusing a completed phone-AI result after lease authority is lost. */
public final class ResultReacquirePolicy {
    private ResultReacquirePolicy() {}

    public static boolean isPersistedResultPhase(String phase) {
        return DurableCheckpointStore.PHASE_RESULT_READY.equals(phase)
                || DurableCheckpointStore.PHASE_SUBMITTING.equals(phase);
    }

    public static void requireSameWork(DurableCheckpointStore.Snapshot previous,
                                       DurableCheckpointStore.JobLease reacquired) throws ApiException {
        if (previous == null || reacquired == null) {
            throw new ApiException(409, "RESULT_REACQUIRE_MISMATCH", "reacquire identity is missing", false, null);
        }
        if (!same(previous.jobId, reacquired.jobId)
                || !same(previous.idempotencyKey, reacquired.idempotencyKey)
                || !same(previous.bindingId, reacquired.bindingId)) {
            throw new ApiException(409, "RESULT_REACQUIRE_MISMATCH",
                    "reacquired lease does not match persisted result identity", false, null);
        }
    }

    private static boolean same(String left, String right) {
        return left != null && right != null && !left.isBlank() && left.equals(right);
    }
}
