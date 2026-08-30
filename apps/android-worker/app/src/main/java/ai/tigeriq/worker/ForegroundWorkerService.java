package ai.tigeriq.worker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

public final class ForegroundWorkerService extends Service {
    private static final String CHANNEL_ID = "tigeriq-worker-runtime";
    private static final int NOTIFICATION_ID = 24027;
    private static final long HEARTBEAT_INTERVAL_MS = 30_000L;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable heartbeat = new Runnable() {
        @Override public void run() {
            // Network transport is intentionally not activated until a paired controller URL
            // and scoped credential are provisioned on the real device.
            WorkerIdentity.ensureDeviceKey();
            handler.postDelayed(this, HEARTBEAT_INTERVAL_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        handler.post(heartbeat);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(heartbeat);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
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
