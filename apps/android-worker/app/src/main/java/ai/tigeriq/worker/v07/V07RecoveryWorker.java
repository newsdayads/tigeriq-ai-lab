package ai.tigeriq.worker.v07;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

/** Recovery/wake path for Controller V1: status -> heartbeat -> lease, with checkpoint resume first. */
public final class V07RecoveryWorker extends Worker {
    public V07RecoveryWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        Context app = getApplicationContext();
        WorkerStatusStore status = new WorkerStatusStore(app);
        try {
            EmployeeDeviceStore identities = new EmployeeDeviceStore(app);
            EmployeeDeviceStore.Profile profile = identities.load();
            if (profile == null) {
                status.setState(WorkerState.NEED_ATTENTION, "Thiết bị chưa activation V1", null);
                return Result.success();
            }

            TigerIqApiClient api = new TigerIqApiClient(profile);
            api.requireControllerV1Ready();

            DurableCheckpointStore checkpoints = new DurableCheckpointStore(app);
            DurableCheckpointStore.Snapshot snapshot = checkpoints.load();
            if (snapshot.hasInFlightWork()) {
                if (!snapshot.leaseExpired(System.currentTimeMillis())) {
                    String authority = checkpoints.leaseToken(snapshot);
                    if (authority != null && !authority.isBlank()) {
                        DirectAiJobAdapter.requireBinding(profile, snapshot);
                        sendHeartbeat(api, app, "working", snapshot.jobId);
                        status.setState(WorkerState.WORKING, "Khôi phục JOB đang dở", snapshot.jobId);
                        V07WorkScheduler.enqueueJob(app, profile.employeeId, snapshot.jobId, snapshot.idempotencyKey);
                    } else {
                        long delay = Math.max(1_000L, snapshot.leaseExpiresAtEpochMs - System.currentTimeMillis() + 1_000L);
                        status.setState(WorkerState.WORKING, "Sau reboot: chờ lease cũ hết hạn để reacquire", snapshot.jobId);
                        V07WorkScheduler.enqueueRecoveryAfter(app, delay);
                    }
                    return Result.success();
                }
                checkpoints.clear();
            }

            sendHeartbeat(api, app, new ProviderConfigStore(app).hasGeminiKey() ? "ok" : "degraded", null);
            TigerIqApiClient.LeaseResult leased = api.leaseNextJob();
            if (leased.empty) {
                status.setState(WorkerState.READY, "Controller V1 sẵn sàng · chưa có JOB", null);
                return Result.success();
            }

            profile = identities.bindAuthoritativeBinding(profile, leased.lease.bindingId);
            identities.requireBinding(profile, leased.lease.bindingId);
            checkpoints.saveLease(leased.lease);
            status.setState(WorkerState.WORKING, "Đã nhận lease JOB từ Controller V1", leased.lease.jobId);
            V07WorkScheduler.enqueueJob(app, profile.employeeId, leased.lease.jobId, leased.lease.idempotencyKey);
            return Result.success();
        } catch (ApiException error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), error.retryable);
            WorkerState state = canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION;
            status.setState(state, "Controller V1: " + error.code, null);
            return canRetry ? Result.retry() : Result.success();
        } catch (Exception error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), true);
            status.setState(canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION,
                    canRetry ? "Mất kết nối/cục bộ; sẽ thử lại hữu hạn" : "Recovery dừng sau giới hạn retry", null);
            return canRetry ? Result.retry() : Result.success();
        }
    }

    private static void sendHeartbeat(TigerIqApiClient api, Context app, String health, String jobId) throws Exception {
        ProviderConfigStore config = new ProviderConfigStore(app);
        JSONObject metadata = new JSONObject()
                .put("source", "android-ai-employee-v1")
                .put("protocol", ControllerV1Contract.PROTOCOL)
                .put("provider", ProviderConfigStore.GEMINI)
                .put("providerConfigured", config.hasGeminiKey());
        if (jobId != null && !jobId.isBlank()) metadata.put("jobId", jobId);
        api.heartbeat(health, metadata);
    }
}
