package ai.tigeriq.worker.v07;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

public final class V07WorkScheduler {
    private static final String RECOVERY_WORK = "tigeriq-v07-recovery";
    private V07WorkScheduler() {}

    public static void enqueueRecovery(Context context) {
        Constraints network = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(V07RecoveryWorker.class)
                .setConstraints(network)
                .addTag(RECOVERY_WORK)
                .build();
        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniqueWork(RECOVERY_WORK, ExistingWorkPolicy.KEEP, request);
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
