package ai.tigeriq.worker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

public final class UpdateInstallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_SUCCESS) {
            WorkerUpdateEngine.markInstallCallback(context, "INSTALL_SUCCESS_CALLBACK", "");
            return;
        }
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            WorkerUpdateEngine.markInstallCallback(context, "PENDING_USER_ACTION", message);
            Intent confirm = null;
            if (Build.VERSION.SDK_INT >= 33) {
                confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
            } else {
                confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            }
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirm);
                    WorkerUpdateEngine.markInstallCallback(context, "PENDING_USER_ACTION_OPENED", message);
                } catch (Exception error) {
                    WorkerUpdateEngine.markInstallCallback(context, "PENDING_USER_ACTION", error.getMessage());
                }
            }
            return;
        }
        WorkerUpdateEngine.markInstallCallback(
            context,
            "INSTALL_FAILED_" + status,
            message == null ? "package_installer_failure" : message
        );
    }
}
