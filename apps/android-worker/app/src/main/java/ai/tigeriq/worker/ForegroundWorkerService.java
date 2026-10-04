package ai.tigeriq.worker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

import org.json.JSONObject;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class ForegroundWorkerService extends Service {
    public static final String PREFS = "tigeriq-worker-runtime-status";
    public static final String KEY_CONTROLLER_STATE = "controllerState";
    public static final String KEY_LAST_HEARTBEAT_AT = "lastHeartbeatAt";
    public static final String KEY_LAST_ERROR = "lastError";

    private static final String CHANNEL_ID = "tigeriq-worker-runtime";
    private static final int NOTIFICATION_ID = 24027;
    private ScheduledExecutorService executor;
    private boolean taskResumeAttempted;
    private long lastLeaseRenewAt;

    @Override
    public void onCreate() {
        super.onCreate();
        WorkerIdentity.ensureDeviceKey();
        ChatGptB1RunStore.cancelStaleManualRunForLiveWorker(this);
        ensureChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::heartbeat, 2, 30, TimeUnit.SECONDS);
        executor.scheduleWithFixedDelay(this::taskLoop, 4, 5, TimeUnit.SECONDS);
        executor.scheduleWithFixedDelay(this::autoUpdate, 20, 15, TimeUnit.MINUTES);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (executor != null) executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void heartbeat() {
        try {
            SecureCredentialStore store = new SecureCredentialStore(this);
            if (store.load() == null) {
                writeRuntime("UNPAIRED", 0L, "");
                return;
            }
            ControllerClient client = new ControllerClient(store);
            client.heartbeat(batteryPct(), null, WorkerVersion.NAME);
            reportPendingB1Evidence(client);
            writeRuntime("ONLINE", System.currentTimeMillis(), "");
        } catch (Exception error) {
            String message = error.getMessage();
            if (message == null || message.trim().isEmpty()) message = error.getClass().getSimpleName();
            long lastSuccess = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getLong(KEY_LAST_HEARTBEAT_AT, 0L);
            writeRuntime("OFFLINE", lastSuccess, message.length() > 160 ? message.substring(0, 160) : message);
        }
    }

    private void taskLoop() {
        try {
            SecureCredentialStore store = new SecureCredentialStore(this);
            if (store.load() == null) return;
            ControllerClient client = new ControllerClient(store);
            MobileTaskStore.Snapshot task = MobileTaskStore.read(this);
            ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);

            if (task.present()) {
                boolean sameTaskRun = task.taskId.equals(run.taskId) && task.runId.equals(run.runId);
                if (sameTaskRun && ChatGptB1RunStore.failWaitingProjectIfTimedOut(
                    this,
                    task.runId,
                    task.taskId,
                    SystemClock.elapsedRealtime()
                )) {
                    run = ChatGptB1RunStore.read(this);
                    sameTaskRun = task.taskId.equals(run.taskId) && task.runId.equals(run.runId);
                }

                // A manual/different B1 run owns ChatGPT until it reaches terminal state.
                // Keep the already-leased Core task alive, but never launch/overwrite the manual run.
                if (run.active() && !sameTaskRun) {
                    long now = System.currentTimeMillis();
                    if (lastLeaseRenewAt == 0L || now - lastLeaseRenewAt >= 60_000L) {
                        task = renewTaskLease(client, task);
                        lastLeaseRenewAt = now;
                    }
                    return;
                }

                // Drain evidence from the manual/different run before starting the waiting Core task.
                if (run.terminal() && !sameTaskRun) {
                    reportPendingB1Evidence(client);
                    run = ChatGptB1RunStore.read(this);
                    if (run.evidenceSeq > run.reportedSeq) return;
                    long now = System.currentTimeMillis();
                    if (lastLeaseRenewAt == 0L || now - lastLeaseRenewAt >= 60_000L) {
                        task = renewTaskLease(client, task);
                        lastLeaseRenewAt = now;
                    }
                    ChatGptB1RunStore.startTask(this, task.runId, task.taskId, task.prompt, task.expectedToken);
                    launchChatGpt();
                    taskResumeAttempted = true;
                    return;
                }

                if (sameTaskRun && run.terminal()) {
                    if (!task.resultReported) {
                        JSONObject result = new JSONObject();
                        result.put("status", "COMPLETE".equals(run.state) ? "completed" : "failed");
                        JSONObject output = new JSONObject();
                        if ("COMPLETE".equals(run.state)) output.put("validatedToken", task.expectedToken);
                        output.put("responseText", run.responseText == null ? "" : run.responseText);
                        output.put("runState", run.state);
                        output.put("sendCount", run.sendCount);
                        output.put("duplicateSendCount", run.duplicateSendCount);
                        output.put("recoveryCount", run.recoveryCount);
                        output.put("lastError", run.lastError);
                        result.put("output", output);
                        try {
                            client.submitResult(task.taskId, task.leaseId, task.leaseId, result);
                        } catch (ControllerClient.ControllerException stale) {
                            if (stale.status != 409) throw stale;
                            JSONObject reacquired = client.pollLease();
                            if (!reacquired.optBoolean("leased", false)) throw stale;
                            task = MobileTaskStore.rebindLease(this, reacquired.getJSONObject("task"));
                            client.submitResult(task.taskId, task.leaseId, task.leaseId, result);
                        }
                        MobileTaskStore.markResultReported(this);
                    }
                    reportPendingB1Evidence(client);
                    run = ChatGptB1RunStore.read(this);
                    if (run.evidenceSeq > run.reportedSeq) return;
                    MobileTaskStore.clear(this);
                    taskResumeAttempted = false;
                    lastLeaseRenewAt = 0L;
                    return;
                }

                if (!run.active()) {
                    ChatGptB1RunStore.startTask(this, task.runId, task.taskId, task.prompt, task.expectedToken);
                    launchChatGpt();
                    taskResumeAttempted = true;
                    return;
                }

                long now = System.currentTimeMillis();
                if (lastLeaseRenewAt == 0L || now - lastLeaseRenewAt >= 60_000L) {
                    task = renewTaskLease(client, task);
                    lastLeaseRenewAt = now;
                }
                if (!taskResumeAttempted) {
                    ChatGptB1RunStore.markRecovery(this);
                    launchChatGpt();
                    taskResumeAttempted = true;
                }
                return;
            }

            if (run.terminal() && run.evidenceSeq > run.reportedSeq) {
                reportPendingB1Evidence(client);
                run = ChatGptB1RunStore.read(this);
                if (run.evidenceSeq > run.reportedSeq) return;
            }
            if (run.active()) return;

            if (!WorkerUpdateEngine.beginTaskLease(this)) return;
            try {
                JSONObject leased = client.pollLease();
                if (!leased.optBoolean("leased", false)) return;
                MobileTaskStore.Snapshot bound = MobileTaskStore.bind(this, leased.getJSONObject("task"));
                ChatGptB1RunStore.startTask(this, bound.runId, bound.taskId, bound.prompt, bound.expectedToken);
                lastLeaseRenewAt = System.currentTimeMillis();
                launchChatGpt();
                taskResumeAttempted = true;
            } finally {
                WorkerUpdateEngine.endTaskLease();
            }
        } catch (Exception error) {
            String message = error.getMessage();
            if (message == null || message.trim().isEmpty()) message = error.getClass().getSimpleName();
            long lastSuccess = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_HEARTBEAT_AT, 0L);
            writeRuntime("TASK_ERROR", lastSuccess, message.length() > 160 ? message.substring(0, 160) : message);
        }
    }

    private MobileTaskStore.Snapshot renewTaskLease(ControllerClient client, MobileTaskStore.Snapshot task) throws Exception {
        try {
            client.renewLease(task.taskId, task.leaseId);
            return task;
        } catch (ControllerClient.ControllerException stale) {
            if (stale.status != 409) throw stale;
            JSONObject reacquired = client.pollLease();
            if (!reacquired.optBoolean("leased", false)) throw stale;
            return MobileTaskStore.rebindLease(this, reacquired.getJSONObject("task"));
        }
    }

    private void launchChatGpt() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.openai.chatgpt");
        if (launch == null) {
            ChatGptB1RunStore.fail(this, "CHATGPT_NOT_INSTALLED");
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(launch);
    }

    private void autoUpdate() {
        try {
            ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
            boolean evidencePending = run.terminal() && run.evidenceSeq > run.reportedSeq;
            if (run.active() || evidencePending || MobileTaskStore.read(this).present()) return;
            WorkerUpdateEngine.checkAndInstall(this, false);
        } catch (Exception error) {
            String message = error.getMessage();
            if (message == null || message.trim().isEmpty()) message = error.getClass().getSimpleName();
            WorkerUpdateEngine.markInstallCallback(this, "AUTO_UPDATE_FAILED", message);
        }
    }

    private void reportPendingB1Evidence(ControllerClient client) {
        try {
            ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
            if (!run.terminal() || run.evidenceSeq <= run.reportedSeq || run.evidenceSeq < 1) return;
            client.reportEvidence(ChatGptB1RunStore.evidencePayload(this));
            ChatGptB1RunStore.markReported(this, run.evidenceSeq);
        } catch (Exception ignored) {
            // Heartbeat loop will retry idempotently on the next cycle.
        }
    }

    private int batteryPct() {
        BatteryManager manager = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
        if (manager == null) return 0;
        int value = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        return Math.max(0, Math.min(100, value));
    }

    private void writeRuntime(String state, long heartbeatAt, String error) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_CONTROLLER_STATE, state)
            .putLong(KEY_LAST_HEARTBEAT_AT, heartbeatAt)
            .putString(KEY_LAST_ERROR, error)
            .apply();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "TigerIQ AI Worker", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Persistent TigerIQ worker runtime status");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setContentTitle("TigerIQ AI Worker")
            .setContentText("Worker đang hoạt động nền")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setOngoing(true)
            .build();
    }
}
