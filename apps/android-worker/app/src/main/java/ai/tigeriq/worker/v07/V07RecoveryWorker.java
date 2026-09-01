package ai.tigeriq.worker.v07;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class V07RecoveryWorker extends Worker {
    public V07RecoveryWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        Context app = getApplicationContext();
        WorkerStatusStore status = new WorkerStatusStore(app);
        try {
            EmployeeDeviceStore identities = new EmployeeDeviceStore(app);
            EmployeeDeviceStore.Profile profile = identities.load();
            if (profile == null) {
                status.setState(WorkerState.NEED_ATTENTION, "Thiết bị chưa enrollment", null);
                return Result.success();
            }
            String sessionToken = new SessionManager(app).validToken(profile);
            DurableCheckpointStore checkpoints = new DurableCheckpointStore(app);
            DurableCheckpointStore.Snapshot snapshot = checkpoints.load();
            if (snapshot.hasInFlightWork()) {
                if (!snapshot.leaseExpired(System.currentTimeMillis())) {
                    String authority = checkpoints.leaseToken(snapshot);
                    if (authority != null && !authority.isBlank()) {
                        ApiFirstJobAdapter.requireBinding(profile, snapshot);
                        status.setState(WorkerState.WORKING, "Khôi phục công việc đang dở", snapshot.jobId);
                        V07WorkScheduler.enqueueJob(app, profile.employeeId, snapshot.jobId, snapshot.idempotencyKey);
                    } else {
                        long delay = Math.max(1_000L, snapshot.leaseExpiresAtEpochMs - System.currentTimeMillis() + 1_000L);
                        status.setState(WorkerState.WORKING, "Chờ lease cũ hết hạn để reacquire", snapshot.jobId);
                        V07WorkScheduler.enqueueRecoveryAfter(app, delay);
                    }
                    return Result.success();
                }
                checkpoints.clear();
            }
            TigerIqApiClient.PullResult pulled = new TigerIqApiClient(profile).pullJob(sessionToken);
            if (pulled.empty) {
                status.setState(WorkerState.READY, "Sẵn sàng nhận việc", null);
                return Result.success();
            }
            profile = identities.bindAuthoritativeBinding(profile, pulled.lease.bindingId);
            identities.requireBinding(profile, pulled.lease.bindingId);
            checkpoints.saveLease(pulled.lease);
            status.setState(WorkerState.WORKING, "Đã nhận việc · binding verified", pulled.lease.jobId);
            V07WorkScheduler.enqueueJob(app, profile.employeeId, pulled.lease.jobId, pulled.lease.idempotencyKey);
            return Result.success();
        } catch (ApiException error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), error.retryable);
            WorkerState state = error.isTokenExpired() || error.isUnauthorized() || "REENROLL_REQUIRED".equals(error.code) || "STALE_BINDING".equals(error.code) || "BINDING_IDENTITY_MISMATCH".equals(error.code) ? WorkerState.NEED_ATTENTION : (canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION);
            status.setState(state, "Recovery API: " + error.code, null);
            return canRetry ? Result.retry() : Result.failure();
        } catch (Exception error) {
            boolean canRetry = RetryPolicy.canRetry(getRunAttemptCount(), true);
            status.setState(canRetry ? WorkerState.WORKING : WorkerState.NEED_ATTENTION, canRetry ? "Recovery lỗi cục bộ; sẽ thử lại hữu hạn" : "Recovery dừng sau giới hạn retry", null);
            return canRetry ? Result.retry() : Result.failure();
        }
    }
}
