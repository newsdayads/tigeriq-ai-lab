package ai.tigeriq.worker.v07;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Durable fail-safe wake path when push delivery is unavailable or not configured.
 * It does not execute a job itself; it only triggers the unique recovery work.
 */
public final class V07PeriodicWakeWorker extends Worker {
    public V07PeriodicWakeWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull @Override public Result doWork() {
        V07WorkScheduler.enqueueRecovery(getApplicationContext());
        return Result.success();
    }
}
