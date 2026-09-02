package ai.tigeriq.worker.v07;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.time.Instant;
import java.util.UUID;

/** V1 execution path: PC01 gives the JOB; this phone calls its own AI provider directly. */
public final class V07JobWorker extends Worker {
    public V07JobWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        Context app = getApplicationContext();
        WorkerStatusStore status = new WorkerStatusStore(app);
        DurableCheckpointStore checkpoints = new DurableCheckpointStore(app);
        try {
            EmployeeDeviceStore.Profile profile = new EmployeeDeviceStore(app).load();
            if (profile == null) {
                status.setState(WorkerState.NEED_ATTENTION, "Thiết bị chưa activation với PC01", null);
                return Result.failure();
            }
            DurableCheckpointStore.Snapshot snapshot = checkpoints.load();
            if (!snapshot.hasInFlightWork()) {
                status.setState(WorkerState.READY, "Sẵn sàng nhận JOB từ PC01", null);
                return Result.success();
            }
            DirectAiJobAdapter.requireBinding(profile, snapshot);
            if (snapshot.leaseExpired(System.currentTimeMillis())) {
                checkpoints.clear();
                status.setState(WorkerState.READY, "Lease hết hạn; xin lại JOB từ PC01", null);
                V07WorkScheduler.enqueueRecovery(app);
                return Result.success();
            }
            String leaseToken = checkpoints.leaseToken(snapshot);
            if (leaseToken == null || leaseToken.isBlank()) {
                status.setState(WorkerState.WORKING, "Sau reboot: chờ lease cũ hết hạn để xin lại JOB", snapshot.jobId);
                V07WorkScheduler.enqueueRecovery(app);
                return Result.success();
            }

            JSONObject result;
            if (DurableCheckpointStore.PHASE_RESULT_READY.equals(snapshot.phase) || DurableCheckpointStore.PHASE_SUBMITTING.equals(snapshot.phase)) {
                String persisted = checkpoints.resultJson(snapshot);
                if (persisted == null || persisted.isBlank()) throw new ApiException(409, "RESULT_MISSING", "persisted result missing", false, null);
                result = new JSONObject(persisted);
            } else {
                String jobJson = checkpoints.jobJson(snapshot);
                if (jobJson == null || jobJson.isBlank()) throw new ApiException(409, "JOB_MISSING", "persisted job missing", false, null);
                JSONObject job = new JSONObject(jobJson);
                String prompt = DirectAiJobAdapter.requiredPrompt(job);
                ProviderConfigStore providerConfig = new ProviderConfigStore(app);
                String provider = providerConfig.defaultProvider();
                String model = ProviderConfigStore.GEMINI.equals(provider) ? providerConfig.geminiModel() : "";
                AiProviderConnector connector = LocalAiProviderRegistry.connector(app, provider);
                String executionId = snapshot.requestId == null ? "EXEC-" + UUID.randomUUID() : snapshot.requestId;
                String executionKey = snapshot.inferenceIdempotencyKey == null ? "AI-" + WorkNames.sha256(profile.employeeId + "\n" + snapshot.idempotencyKey) : snapshot.inferenceIdempotencyKey;
                String jobStartedAt = Instant.now().toString();
                checkpoints.markPhase(DurableCheckpointStore.PHASE_AI_EXECUTION, executionId, executionKey);
                status.setState(WorkerState.WORKING, "Điện thoại đang gọi " + provider + " trực tiếp", snapshot.jobId);

                ProviderExecution execution;
                String attemptStartedAt = Instant.now().toString();
                try {
                    execution = connector.execute(prompt, model);
                    checkpoints.appendProviderAttempt(execution.provider, execution.model, getRunAttemptCount() + 1, "success", execution.startedAt, execution.finishedAt, "");
                } catch (ProviderException error) {
                    checkpoints.appendProviderAttempt(error.provider, model, getRunAttemptCount() + 1, "error", attemptStartedAt, Instant.now().toString(), error.code);
                    throw error;
                }

                snapshot = checkpoints.load();
                result = DirectAiJobAdapter.result(profile, snapshot, execution, checkpoints.providerAttempts(), jobStartedAt);
                String evidenceSha = result.getJSONArray("evidence").getJSONObject(0).getString("sha256");
                checkpoints.saveResult(result.toString(), evidenceSha);
                snapshot = checkpoints.load();
            }

            // PC01 is contacted only for TigerIQ control-plane/session + result submission, never for AI inference.
            String sessionToken = new SessionManager(app).validToken(profile);
            TigerIqApiClient api = new TigerIqApiClient(profile);
            checkpoints.markPhase(DurableCheckpointStore.PHASE_SUBMITTING, snapshot.requestId, snapshot.inferenceIdempotencyKey);
            api.submitResult(sessionToken, DirectAiJobAdapter.submitRequest(profile, checkpoints.load(), leaseToken, result));
            String jobId = snapshot.jobId;
            checkpoints.clear();
            status.setState(WorkerState.READY, "Đã trả RESULT + evidence về PC01", jobId);
            V07WorkScheduler.enqueueRecovery(app);
            return Result.success();
        } catch (ProviderException error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), error.retryable);
            status.setState(canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION, "AI trên máy: " + error.code, checkpoints.load().jobId);
            return canRetry ? Result.retry() : Result.failure();
        } catch (ApiException error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), error.retryable);
            WorkerState state = error.isTokenExpired() || error.isUnauthorized() || "REENROLL_REQUIRED".equals(error.code) || "STALE_BINDING".equals(error.code) || "BINDING_REQUIRED".equals(error.code) ? WorkerState.NEED_ATTENTION : (canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION);
            status.setState(state, "PC01 API: " + error.code, checkpoints.load().jobId);
            return canRetry ? Result.retry() : Result.failure();
        } catch (Exception error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), true);
            status.setState(canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION, canRetry ? "Lỗi cục bộ; sẽ thử lại hữu hạn" : "Worker dừng sau giới hạn retry", checkpoints.load().jobId);
            return canRetry ? Result.retry() : Result.failure();
        }
    }
}
