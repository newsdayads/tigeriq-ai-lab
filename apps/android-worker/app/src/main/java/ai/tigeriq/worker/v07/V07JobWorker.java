package ai.tigeriq.worker.v07;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class V07JobWorker extends Worker {
    public V07JobWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        Context app = getApplicationContext();
        WorkerStatusStore status = new WorkerStatusStore(app);
        DurableCheckpointStore checkpoints = new DurableCheckpointStore(app);
        try {
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
            // v0.7 intentionally has no Accessibility/shell execution path. The concrete
            // API-first payload adapter is added only after the locked payload contract is mapped.
            status.setState(WorkerState.NEED_ATTENTION, "Job đã giữ an toàn; chờ API-first payload adapter", snapshot.jobId);
            return Result.success();
        } catch (Exception error) {
            status.setState(WorkerState.NEED_ATTENTION, "Không đọc được checkpoint an toàn", null);
            return Result.retry();
        }
    }
}
