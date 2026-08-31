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
            EmployeeDeviceStore.Profile profile = new EmployeeDeviceStore(app).load();
            if (profile == null) {
                status.setState(WorkerState.NEED_ATTENTION, "Thiết bị chưa enrollment", null);
                return Result.success();
            }
            SecureSecretStore secrets = new SecureSecretStore(app);
            String bootstrap = secrets.get(SecureSecretStore.BOOTSTRAP_TOKEN);
            if (bootstrap == null || bootstrap.isBlank()) {
                status.setState(WorkerState.NEED_ATTENTION, "Thiếu bootstrap credential", null);
                return Result.success();
            }
            DurableCheckpointStore checkpoints = new DurableCheckpointStore(app);
            DurableCheckpointStore.Snapshot snapshot = checkpoints.load();
            if (snapshot.hasInFlightWork()) {
                if (!snapshot.leaseExpired(System.currentTimeMillis())) {
                    status.setState(WorkerState.WORKING, "Khôi phục công việc đang dở", snapshot.jobId);
                    V07WorkScheduler.enqueueJob(app, profile.employeeId, snapshot.jobId, snapshot.idempotencyKey);
                    return Result.success();
                }
                checkpoints.clear();
            }
            TigerIqApiClient.PullResult pulled = new TigerIqApiClient(profile).pullJob(bootstrap);
            if (pulled.empty) {
                status.setState(WorkerState.READY, "Sẵn sàng nhận việc", null);
                return Result.success();
            }
            checkpoints.saveLease(pulled.lease);
            status.setState(WorkerState.WORKING, "Đã nhận việc", pulled.lease.jobId);
            V07WorkScheduler.enqueueJob(app, profile.employeeId, pulled.lease.jobId, pulled.lease.idempotencyKey);
            return Result.success();
        } catch (ApiException error) {
            status.setState(error.retryable ? WorkerState.WORKING : WorkerState.NEED_ATTENTION, "Recovery API: " + error.code, null);
            return error.retryable ? Result.retry() : Result.failure();
        } catch (Exception error) {
            status.setState(WorkerState.NEED_ATTENTION, "Recovery lỗi cục bộ", null);
            return Result.retry();
        }
    }
}
