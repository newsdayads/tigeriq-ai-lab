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

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class ForegroundWorkerService extends Service {
    public static final String PREFS = "tigeriq-worker-runtime-status";
    public static final String KEY_CONTROLLER_STATE = "controllerState";
    public static final String KEY_LAST_HEARTBEAT_AT = "lastHeartbeatAt";
    public static final String KEY_LAST_ERROR = "lastError";
    public static final String KEY_LOCAL_RUNTIME = "localRuntime";

    private static final String CHANNEL_ID = "tigeriq-worker-runtime";
    private static final int NOTIFICATION_ID = 24027;
    private static final long LOCAL_TASK_TIMEOUT_MS = 150_000L;
    private ScheduledExecutorService executor;

    @Override
    public void onCreate() {
        super.onCreate();
        WorkerIdentity.ensureDeviceKey();
        ensureChannel();
        startForeground(NOTIFICATION_ID, buildNotification("Sẵn sàng làm việc trên điện thoại"));
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::tick, 2, 15, TimeUnit.SECONDS);
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

    private void tick() {
        try {
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_LOCAL_RUNTIME, "ACTIVE")
                .apply();
            enforceLocalTaskDeadline();
            heartbeatControllerIfPaired();
            refreshNotification();
        } catch (Exception error) {
            String message = error.getMessage();
            if (message == null || message.trim().isEmpty()) message = error.getClass().getSimpleName();
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_LAST_ERROR, message.length() > 160 ? message.substring(0, 160) : message)
                .apply();
        }
    }

    private void enforceLocalTaskDeadline() {
        LocalTaskStore.Snapshot task = LocalTaskStore.load(this);
        if (!task.active() || task.startedAt <= 0L) return;
        if (System.currentTimeMillis() - task.startedAt > LOCAL_TASK_TIMEOUT_MS) {
            LocalTaskStore.fail(this, "TIMEOUT");
        }
    }

    private void heartbeatControllerIfPaired() {
        try {
            SecureCredentialStore store = new SecureCredentialStore(this);
            if (store.load() == null) {
                writeController("OPTIONAL_UNPAIRED", 0L, "");
                return;
            }
            ControllerClient client = new ControllerClient(store);
            client.heartbeat(batteryPct(), null, WorkerVersion.NAME);
            writeController("ONLINE", System.currentTimeMillis(), "");
        } catch (Exception error) {
            String message = error.getMessage();
            if (message == null || message.trim().isEmpty()) message = error.getClass().getSimpleName();
            writeController("OPTIONAL_OFFLINE", 0L, message.length() > 160 ? message.substring(0, 160) : message);
        }
    }

    private int batteryPct() {
        BatteryManager manager = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
        if (manager == null) return 0;
        int value = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        return Math.max(0, Math.min(100, value));
    }

    private void writeController(String state, long heartbeatAt, String error) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_CONTROLLER_STATE, state)
            .putLong(KEY_LAST_HEARTBEAT_AT, heartbeatAt)
            .putString(KEY_LAST_ERROR, error)
            .apply();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "TigerIQ Worker", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("TigerIQ AI employee runtime");
        manager.createNotificationChannel(channel);
    }

    private void refreshNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        LocalTaskStore.Snapshot task = LocalTaskStore.load(this);
        String text;
        if (LocalTaskStore.RESULT_READY.equals(task.state)) text = "Đã có kết quả công việc";
        else if (LocalTaskStore.FAILED.equals(task.state)) text = "Công việc cần kiểm tra";
        else if (task.active()) text = "Đang làm việc với Gemini";
        else text = "Sẵn sàng làm việc trên điện thoại";
        manager.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private Notification buildNotification(String text) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setContentTitle("TigerIQ AI · Worker")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setOngoing(true)
            .build();
    }
}
