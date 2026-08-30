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

    private static final String CHANNEL_ID = "tigeriq-worker-runtime";
    private static final int NOTIFICATION_ID = 24027;
    private ScheduledExecutorService executor;

    @Override
    public void onCreate() {
        super.onCreate();
        WorkerIdentity.ensureDeviceKey();
        ensureChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::heartbeat, 2, 30, TimeUnit.SECONDS);
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
            client.heartbeat(batteryPct(), null, BuildConfig.VERSION_NAME);
            writeRuntime("ONLINE", System.currentTimeMillis(), "");
        } catch (Exception error) {
            String message = error.getMessage();
            if (message == null || message.trim().isEmpty()) message = error.getClass().getSimpleName();
            writeRuntime("OFFLINE", 0L, message.length() > 160 ? message.substring(0, 160) : message);
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
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "TigerIQ Worker", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Persistent TigerIQ worker runtime status");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setContentTitle("TigerIQ Worker")
            .setContentText("Worker runtime active")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setOngoing(true)
            .build();
    }
}
