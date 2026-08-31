package ai.tigeriq.worker.v07;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class V07BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            V07WorkScheduler.enqueueRecovery(context);
        }
    }
}
