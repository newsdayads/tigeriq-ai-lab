package ai.tigeriq.worker.v07;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.UUID;

public final class V07JobWorker extends Worker {
    public V07JobWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        Context app = getApplicationContext();
        WorkerStatusStore status = new WorkerStatusStore(app);
        DurableCheckpointStore checkpoints = new DurableCheckpointStore(app);
        try {
            EmployeeDeviceStore.Profile profile = new EmployeeDeviceStore(app).load();
            if (profile == null) {
                status.setState(WorkerState.NEED_ATTENTION, "Thiết bị chưa enrollment", null);
                return Result.failure();
            }
            DurableCheckpointStore.Snapshot snapshot = checkpoints.load();
            if (!snapshot.hasInFlightWork()) {
                status.setState(WorkerState.READY, "Không có checkpoint đang chạy", null);
                return Result.success();
            }
            if (snapshot.leaseExpired(System.currentTimeMillis())) {
                checkpoints.clear();
                status.setState(WorkerState.READY, "Lease hết hạn; chờ nhận lại từ server", null);
                V07WorkScheduler.enqueueRecovery(app);
                return Result.success();
            }
            String sessionToken = new SessionManager(app).validToken(profile);
            TigerIqApiClient api = new TigerIqApiClient(profile);
            String leaseToken = checkpoints.leaseToken(snapshot);

            JSONObject result;
            if (DurableCheckpointStore.PHASE_RESULT_READY.equals(snapshot.phase) || DurableCheckpointStore.PHASE_SUBMITTING.equals(snapshot.phase)) {
                String persisted = checkpoints.resultJson(snapshot);
                if (persisted == null || persisted.isBlank()) throw new ApiException(409, "RESULT_MISSING", "persisted result missing", false, null);
                result = new JSONObject(persisted);
            } else {
                String jobJson = checkpoints.jobJson(snapshot);
                if (jobJson == null || jobJson.isBlank()) throw new ApiException(409, "JOB_MISSING", "persisted job missing", false, null);
                String requestId = snapshot.requestId == null ? "REQ-" + UUID.randomUUID() : snapshot.requestId;
                String inferenceKey = snapshot.inferenceIdempotencyKey == null ? "INF-" + WorkNames.sha256(profile.employeeId + "\n" + snapshot.idempotencyKey) : snapshot.inferenceIdempotencyKey;
                checkpoints.markPhase(DurableCheckpointStore.PHASE_INFERENCE, requestId, inferenceKey);
                status.setState(WorkerState.WORKING, "Đang thực thi qua TigerIQ API", snapshot.jobId);
                JSONObject inference = api.invokeInference(sessionToken, ApiFirstJobAdapter.inferenceRequest(profile, new JSONObject(jobJson), requestId), inferenceKey);
                DurableCheckpointStore.Snapshot afterInference = checkpoints.load();
                result = ApiFirstJobAdapter.result(profile, afterInference, inference);
                String evidenceSha = result.getJSONArray("evidence").getJSONObject(0).getString("sha256");
                checkpoints.saveResult(result.toString(), evidenceSha);
                snapshot = checkpoints.load();
            }

            checkpoints.markPhase(DurableCheckpointStore.PHASE_SUBMITTING, snapshot.requestId, snapshot.inferenceIdempotencyKey);
            api.submitResult(sessionToken, ApiFirstJobAdapter.submitRequest(profile, checkpoints.load(), leaseToken, result));
            String jobId = snapshot.jobId;
            checkpoints.clear();
            status.setState(WorkerState.READY, "Đã gửi kết quả và evidence", jobId);
            V07WorkScheduler.enqueueRecovery(app);
            return Result.success();
        } catch (ApiException error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), error.retryable);
            WorkerState state = error.isTokenExpired() || error.isUnauthorized() || "REENROLL_REQUIRED".equals(error.code) ? WorkerState.NEED_ATTENTION : (canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION);
            status.setState(state, "Job API: " + error.code, checkpoints.load().jobId);
            return canRetry ? Result.retry() : Result.failure();
        } catch (Exception error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), true);
            status.setState(canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION, "Job lỗi cục bộ fail-closed", checkpoints.load().jobId);
            return canRetry ? Result.retry() : Result.failure();
        }
    }
}
