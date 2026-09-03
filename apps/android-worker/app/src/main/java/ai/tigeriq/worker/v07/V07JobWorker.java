package ai.tigeriq.worker.v07;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.time.Instant;
import java.util.UUID;

/** V1 execution path: Controller leases the JOB; this phone calls its own AI provider directly. */
public final class V07JobWorker extends Worker {
    public V07JobWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        Context app = getApplicationContext();
        WorkerStatusStore status = new WorkerStatusStore(app);
        DurableCheckpointStore checkpoints = new DurableCheckpointStore(app);
        try {
            EmployeeDeviceStore.Profile profile = new EmployeeDeviceStore(app).load();
            if (profile == null) {
                status.setState(WorkerState.NEED_ATTENTION, "Thiết bị chưa activation với Controller V1", null);
                return Result.failure();
            }
            DurableCheckpointStore.Snapshot snapshot = checkpoints.load();
            if (!snapshot.hasInFlightWork()) {
                status.setState(WorkerState.READY, "Sẵn sàng lease JOB từ Controller V1", null);
                return Result.success();
            }
            DirectAiJobAdapter.requireBinding(profile, snapshot);
            if (snapshot.leaseExpired(System.currentTimeMillis())) {
                if (ResultReacquirePolicy.isPersistedResultPhase(snapshot.phase)) {
                    if (!checkpoints.hasPersistedResult(snapshot)) {
                        throw new ApiException(409, "RESULT_MISSING", "persisted result missing after lease expiry", false, null);
                    }
                    status.setState(WorkerState.WORKING, "Lease hết hạn nhưng RESULT đã lưu; reacquire đúng JOB trước khi submit", snapshot.jobId);
                    V07WorkScheduler.enqueueRecovery(app);
                    return Result.success();
                }
                checkpoints.clear();
                status.setState(WorkerState.READY, "Lease hết hạn; chờ Controller V1 requeue", null);
                V07WorkScheduler.enqueueRecovery(app);
                return Result.success();
            }
            String leaseToken = checkpoints.leaseToken(snapshot);
            if (leaseToken == null || leaseToken.isBlank()) {
                status.setState(WorkerState.WORKING, "Sau reboot: không giả lease token; chờ expiry/reacquire", snapshot.jobId);
                V07WorkScheduler.enqueueRecoveryAfter(app, Math.max(1_000L, snapshot.leaseExpiresAtEpochMs - System.currentTimeMillis() + 1_000L));
                return Result.success();
            }

            JSONObject result;
            if (DurableCheckpointStore.PHASE_RESULT_READY.equals(snapshot.phase) || DurableCheckpointStore.PHASE_SUBMITTING.equals(snapshot.phase)) {
                String persisted = checkpoints.resultJson(snapshot);
                if (persisted == null || persisted.isBlank()) throw new ApiException(409, "RESULT_MISSING", "persisted result missing", false, null);
                result = new JSONObject(persisted);
            } else {
                result = executePhoneAi(app, profile, snapshot, checkpoints, status);
                if (result == null) return Result.retry();
                snapshot = checkpoints.load();
            }

            TigerIqApiClient api = new TigerIqApiClient(profile);
            api.requireControllerV1Ready();
            checkpoints.markPhase(DurableCheckpointStore.PHASE_SUBMITTING, snapshot.requestId, snapshot.inferenceIdempotencyKey);
            snapshot = checkpoints.load();
            api.submitResult(snapshot.jobId, DirectAiJobAdapter.submitRequest(profile, snapshot, leaseToken, result));
            String jobId = snapshot.jobId;
            checkpoints.clear();
            status.setState(WorkerState.READY, "Đã trả RESULT + evidence theo Controller V1", jobId);
            V07WorkScheduler.enqueueRecovery(app);
            return Result.success();
        } catch (ApiException error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), error.retryable);
            status.setState(canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION, "Controller V1: " + error.code, checkpoints.load().jobId);
            return canRetry ? Result.retry() : Result.failure();
        } catch (Exception error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), true);
            status.setState(canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION,
                    canRetry ? "Lỗi cục bộ/mạng; sẽ thử lại hữu hạn" : "Worker dừng sau giới hạn retry", checkpoints.load().jobId);
            return canRetry ? Result.retry() : Result.failure();
        }
    }

    /** Returns null only when provider execution should be retried by WorkManager. */
    private JSONObject executePhoneAi(Context app, EmployeeDeviceStore.Profile profile,
                                      DurableCheckpointStore.Snapshot snapshot, DurableCheckpointStore checkpoints,
                                      WorkerStatusStore status) throws Exception {
        String jobJson = checkpoints.jobJson(snapshot);
        if (jobJson == null || jobJson.isBlank()) throw new ApiException(409, "JOB_MISSING", "persisted job missing", false, null);
        JSONObject job = new JSONObject(jobJson);
        String prompt = DirectAiJobAdapter.requiredPrompt(job);
        ProviderConfigStore providerConfig = new ProviderConfigStore(app);
        String provider = providerConfig.defaultProvider();
        String model = ProviderConfigStore.GEMINI.equals(provider) ? providerConfig.geminiModel() : "";
        AiProviderConnector connector = LocalAiProviderRegistry.connector(app, provider);
        String executionId = snapshot.requestId == null ? "EXEC-" + UUID.randomUUID() : snapshot.requestId;
        String executionKey = snapshot.inferenceIdempotencyKey == null
                ? "AI-" + WorkNames.sha256(profile.employeeId + "\n" + snapshot.idempotencyKey)
                : snapshot.inferenceIdempotencyKey;
        String jobStartedAt = snapshot.updatedAtEpochMs > 0L
                ? Instant.ofEpochMilli(snapshot.updatedAtEpochMs).toString()
                : Instant.now().toString();
        checkpoints.markPhase(DurableCheckpointStore.PHASE_AI_EXECUTION, executionId, executionKey);
        status.setState(WorkerState.WORKING, "Đang kiểm tra zero-cost authority độc lập trước khi gọi " + provider, snapshot.jobId);

        String attemptStartedAt = Instant.now().toString();
        try {
            ProviderExecution execution = ZeroCostPolicy.executeIfAuthorized(
                    providerConfig.zeroCostAuthority(), connector, prompt, model);
            checkpoints.appendProviderAttempt(execution.provider, execution.model, getRunAttemptCount() + 1,
                    "success", execution.startedAt, execution.finishedAt, "");
            snapshot = checkpoints.load();
            JSONObject result = DirectAiJobAdapter.completedResult(profile, snapshot, execution, checkpoints.providerAttempts(), jobStartedAt);
            persistResult(checkpoints, result);
            return result;
        } catch (ProviderException error) {
            String finishedAt = Instant.now().toString();
            checkpoints.appendProviderAttempt(error.provider, model, getRunAttemptCount() + 1,
                    "error", attemptStartedAt, finishedAt, error.code);
            if (RetryPolicy.canRetry(getRunAttemptCount(), error.retryable)) {
                status.setState(WorkerState.WORKING, "AI trên máy: " + error.code + " · sẽ thử lại hữu hạn", snapshot.jobId);
                return null;
            }
            snapshot = checkpoints.load();
            JSONObject failed = DirectAiJobAdapter.failedResult(profile, snapshot, error.provider, model,
                    checkpoints.providerAttempts(), jobStartedAt, attemptStartedAt, finishedAt,
                    error.code, error.getMessage(), error.retryable);
            persistResult(checkpoints, failed);
            status.setState(WorkerState.WORKING, "AI bị chặn/thất bại; đang báo Controller V1", snapshot.jobId);
            return failed;
        }
    }

    private static void persistResult(DurableCheckpointStore checkpoints, JSONObject result) throws Exception {
        String evidenceSha = result.getJSONArray("evidence").getJSONObject(0).getString("sha256");
        checkpoints.saveResult(result.toString(), evidenceSha);
    }
}
