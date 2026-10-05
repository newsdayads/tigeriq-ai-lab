package ai.tigeriq.worker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class WorkerPackageReplacedReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        WorkerUpdateEngine.markPackageReplaced(context);

        if (WorkerRuntimeControl.isPaused(context)) return;

        Intent service = new Intent(context, ForegroundWorkerService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
            else context.startService(service);
        } catch (Exception ignored) {
            // START_STICKY will recover later if the OS defers this start.
        }

        if (WorkerUpdateEngine.wasUserInitiated(context)) {
            try {
                Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    context.startActivity(launch);
                }
            } catch (Exception ignored) {
                // Runtime resume is authoritative; UI relaunch is best-effort.
            }
        }
    }
}
