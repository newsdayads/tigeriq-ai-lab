package ai.tigeriq.worker.v07;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

public final class V07WorkScheduler {
    private static final String RECOVERY_WORK = "tigeriq-v07-recovery";
    private static final String PERIODIC_WAKE_WORK = "tigeriq-v07-periodic-wake";
    private V07WorkScheduler() {}

    public static void ensurePeriodicRecovery(Context context) {
        Constraints network = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(V07PeriodicWakeWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(network)
                .addTag(PERIODIC_WAKE_WORK)
                .build();
        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniquePeriodicWork(PERIODIC_WAKE_WORK, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    public static void enqueueRecovery(Context context) { enqueueRecoveryAfter(context, 0L); }

    public static void enqueueRecoveryAfter(Context context, long delayMs) {
        Constraints network = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(V07RecoveryWorker.class)
                .setConstraints(network)
                .setInitialDelay(Math.max(0L, delayMs), TimeUnit.MILLISECONDS)
                .addTag(RECOVERY_WORK)
                .build();
        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniqueWork(RECOVERY_WORK, ExistingWorkPolicy.REPLACE, request);
    }

    public static void enqueueJob(Context context, String employeeId, String jobId, String idempotencyKey) {
        String unique = WorkNames.execute(employeeId, idempotencyKey);
        Constraints network = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(V07JobWorker.class)
                .setConstraints(network)
                .addTag("tigeriq-v07-job")
                .addTag(jobId == null ? unique : jobId)
                .addTag(unique)
                .build();
        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniqueWork(unique, ExistingWorkPolicy.KEEP, request);
    }
}
